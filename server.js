const express = require('express');
const path = require('path');
const { obterSessaoAutenticada, resetarSessao, fecharModalAlertaSeExistir } = require('./authService');

const app = express();
const PORT = process.env.PORT || 3000;

const URL_LISTA_AVALIACOES = 'https://apps.autoavaliar.com.br/usbi#/app/avaliacoes/avaliacoes/lista';

// Fila sequencial assíncrona para evitar concorrência de navegação na mesma aba
let filaRequisicao = Promise.resolve();

function executarNaFila(fn) {
    const proxima = filaRequisicao.then(fn, fn);
    filaRequisicao = proxima.catch(() => {});
    return proxima;
}

app.use(express.json());

app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    next();
});

app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'views')));

async function validarSessaoAtiva() {
    try {
        const sessao = await obterSessaoAutenticada();
        if (!sessao || !sessao.pagina || sessao.pagina.isClosed()) {
            throw new Error('PÁGINA_FECHADA');
        }
        await sessao.pagina.evaluate(() => true);
        return sessao;
    } catch (e) {
        console.warn('⚠️ Sessão/página inválida detectada. Resetando instância do navegador...');
        await resetarSessao();
        return await obterSessaoAutenticada();
    }
}

async function buscarPlacaNoSite(placa, tentativa = 1) {
    const placaLimpa = placa.trim().toUpperCase();
    let pagina = null;

    try {
        const sessao = await validarSessaoAtiva();
        pagina = sessao.pagina;

        if (pagina.url().includes('/login')) {
            throw new Error('SESSAO_EXPIRED');
        }

        const seletorInput = 'input[ng-model="ctrl.filters.plate"], input[placeholder*="Placa" i]';

        let estaNaLista = pagina.url().includes('/avaliacoes/avaliacoes/lista');
        let temCampoBusca = await pagina.$(seletorInput).catch(() => null) !== null;

        // Navega para a lista se estiver fora ou sem o input na tela
        if (!estaNaLista || !temCampoBusca) {
            await pagina.goto(URL_LISTA_AVALIACOES, { waitUntil: 'domcontentloaded', timeout: 20000 });
            await fecharModalAlertaSeExistir(pagina);
        }

        await pagina.waitForSelector(seletorInput, { visible: true, timeout: 15000 });

        // Remove modais/overlays que possam bloquear interação com a caixa de texto
        await pagina.evaluate(() => {
            const overlays = document.querySelectorAll('.ngdialog, .ngdialog-overlay, .modal-backdrop');
            overlays.forEach(o => o.remove());
        });

        // Limpa o campo diretamente no DOM e spamma eventos para o Digest Loop do AngularJS
        await pagina.evaluate((sel) => {
            const input = document.querySelector(sel);
            if (input) {
                input.value = '';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }, seletorInput);

        await pagina.click(seletorInput, { clickCount: 3 });
        await pagina.keyboard.press('Backspace');

        // Digita a placa e pesquisa
        await pagina.type(seletorInput, placaLimpa, { delay: 40 });
        await pagina.keyboard.press('Enter');
        
        // Aguarda transição da requisição Angular
        await new Promise(r => setTimeout(r, 2000));
        await fecharModalAlertaSeExistir(pagina);

        const temResultado = await pagina.evaluate(() => {
            const linhas = document.querySelectorAll('table tbody tr');
            const textoCorpo = document.body.innerText;
            if (linhas.length === 0) return false;
            if (textoCorpo.includes('Nenhum registro encontrado') || textoCorpo.includes('Sem resultados')) return false;
            return true;
        });

        if (!temResultado) {
            throw new Error('Placa não encontrada no sistema.');
        }

        const seletorResultado = 'table tbody tr td a, table tbody tr td:nth-child(2)';
        await pagina.waitForSelector(seletorResultado, { timeout: 5000 });

        await pagina.evaluate(() => {
            const modais = document.querySelectorAll('.modal, .modal-backdrop, [class*="overlay"], .ngdialog');
            modais.forEach(m => m.remove());
        });

        await pagina.click(seletorResultado);

        // Espera renderizar os detalhes do veículo
        await pagina.waitForFunction(() => document.querySelector('.car-title')?.innerText.trim().length > 2, { timeout: 15000 });
        await new Promise(r => setTimeout(r, 1500));

        const dados = await pagina.evaluate((p) => {
            const textoGeral = document.body.innerText;
            const versaoCarro = document.querySelector('.car-title')?.innerText.trim() || 'Modelo Não Informado';

            const matchAno = textoGeral.match(/(\d{4}\/\d{4})/);
            const matchKm = textoGeral.match(/([\d\.,]+)\s*Km/i);

            const extrairValorRow = (termoBusca) => {
                const linhas = Array.from(document.querySelectorAll('.row'));
                const linhaEncontrada = linhas.find(el => el.innerText && el.innerText.includes(termoBusca));
                if (linhaEncontrada) {
                    const elValor = linhaEncontrada.querySelector('.pull-right');
                    if (elValor && elValor.innerText.trim()) {
                        return elValor.innerText.trim();
                    }
                }
                return null;
            };

            let cor = extrairValorRow('Cor') || 'N/I';
            if (cor === 'N/I') {
                const matchCor = textoGeral.match(/COR\s*[:\n]?\s*([^\n\r\/]+)/i);
                if (matchCor) cor = matchCor[1].trim();
            }

            let cambio = extrairValorRow('Câmbio') || 'N/I';
            if (cambio === 'N/I' || /^\d+[\d.,]*$/.test(cambio)) {
                const matchCambio = textoGeral.match(/CÂMBIO\s*[:\n]?\s*([^\n\r\/]+)/i);
                if (matchCambio && !/^\d+[\d.,]*$/.test(matchCambio[1].trim())) {
                    cambio = matchCambio[1].trim();
                } else if (/AT6|AT8|AT|AUT|AUTOMÁTICO|AUTOMATICO|CVT/i.test(versaoCarro)) {
                    cambio = 'Automático';
                } else if (/M\/T|MANUAL|MT/i.test(versaoCarro)) {
                    cambio = 'Manual';
                } else {
                    cambio = 'N/I';
                }
            }

            let combustivel = extrairValorRow('Combustível') || 'N/I';
            if (combustivel === 'N/I') {
                const matchCombustivel = textoGeral.match(/COMBUSTÍVEL\s*[:\n]?\s*([^\n\r\/]+)/i);
                if (matchCombustivel) {
                    combustivel = matchCombustivel[1].trim();
                } else if (/FLEX/i.test(versaoCarro)) {
                    combustivel = 'Flex';
                } else if (/DIESEL/i.test(versaoCarro)) {
                    combustivel = 'Diesel';
                } else if (/GASOLINA/i.test(versaoCarro)) {
                    combustivel = 'Gasolina';
                } else if (/HÍBRIDO|HYBRID/i.test(versaoCarro)) {
                    combustivel = 'Híbrido';
                } else if (/ELÉTRICO|ELECTRIC/i.test(versaoCarro)) {
                    combustivel = 'Elétrico';
                }
            }

            const fotos = [];
            const imgs = Array.from(document.querySelectorAll('img.image-original, img.sortImage, img[src*="photo-ecossistema"]'));

            imgs.forEach(img => {
                const src = img.src || img.getAttribute('ng-src') || img.getAttribute('data-src');
                if (src && src.includes('photo-ecossistema') && !fotos.includes(src)) {
                    fotos.push(src);
                }
            });

            if (fotos.length === 0) {
                const elementosImg = Array.from(document.querySelectorAll('img, [style*="background-image"]'));
                elementosImg.forEach(el => {
                    let url = el.src || el.getAttribute('ng-src') || el.getAttribute('data-src');
                    if (!url && el.style.backgroundImage) {
                        const matchBg = el.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
                        if (matchBg) url = matchBg[1];
                    }

                    if (url && url.includes('photo-ecossistema') && !fotos.includes(url)) {
                        fotos.push(url);
                    }
                });
            }

            const mLoja = textoGeral.match(/EMPRESA\s+([^\n\/]+)/i);
            const mSol = textoGeral.match(/SOLICITANTE\s+([^\n\/]+)/i);
            const mVis = textoGeral.match(/AVALIADOR\s+([^\n\/]+)/i) || textoGeral.match(/VISTORIADOR\s+([^\n\/]+)/i);
            const matchValor = textoGeral.match(/Valor:\s*(R\$\s*[\d\.,]+)/i);
            const matchPrecificador = textoGeral.match(/Precificador:\s*([^\n\r\/]+)/i);

            let obsTexto = 'Nenhuma observação registrada.';
            const elObs = document.querySelector('.car-observations, [ng-bind*="observation"], .observation-text');
            
            if (elObs && elObs.innerText.trim().length > 0) {
                obsTexto = elObs.innerText.trim();
            } else {
                const matchObs = textoGeral.match(/OBSERVAÇ[ÕO]ES?\s*[:\n]\s*([^\n\r]+)/i) || 
                                 textoGeral.match(/OBSERVAÇÃO\s+([^\n\/]+)/i);
                if (matchObs && matchObs[1] && matchObs[1].trim().length > 0) {
                    obsTexto = matchObs[1].trim();
                }
            }

            let tabelaFipe = 'Não informado';
            const partesTexto = textoGeral.split(/REFERÊNCIAS/i);
            if (partesTexto.length > 1) {
                const matchFipe = partesTexto[1].substring(0, 800).match(/FIPE\s+Valor\s+(R\$\s*[\d\.,]+)/i) || partesTexto[1].substring(0, 800).match(/FIPE\s+[\s\S]*?(R\$\s*[\d\.,]+)/i);
                if (matchFipe) tabelaFipe = matchFipe[1].trim();
            }

            return {
                placa: p,
                versaoCarro,
                ano: matchAno ? matchAno[1] : 'N/I',
                cor,
                cambio,
                combustivel,
                fotos,
                quilometragem: matchKm ? `${matchKm[1]} km` : 'N/I',
                loja: mLoja ? mLoja[1].trim() : 'Nova PB Peres Vistoria',
                solicitante: mSol ? mSol[1].trim() : 'Não informado',
                vistoriador: mVis ? mVis[1].trim() : 'Não informado',
                valorPago: matchValor ? matchValor[1].trim() : 'R$ 0,00',
                tabelaFipe,
                precificador: matchPrecificador ? matchPrecificador[1].trim() : 'Não informado',
                observacoes: obsTexto
            };
        }, placaLimpa);

        if (dados.tabelaFipe !== 'Não informado' && dados.valorPago !== 'R$ 0,00') {
            const parseVal = str => parseFloat(str.replace('R$', '').replace(/\./g, '').replace(',', '.').trim());
            const numFipe = parseVal(dados.tabelaFipe);
            const numPago = parseVal(dados.valorPago);

            if (numFipe > 0 && numPago > 0) {
                const pct = ((numPago / numFipe) * 100).toFixed(1);
                const dif = numFipe - numPago;

                dados.porcentagemFipe = `${pct.replace('.', ',')}%`;
                dados.diferencaFipe = dif >= 0 
                    ? `R$ ${dif.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` 
                    : `+ R$ ${Math.abs(dif).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
            }
        }

        return dados;

    } catch (erro) {
        console.error(`❌ Erro durante a busca da placa (Tentativa ${tentativa}):`, erro.message);

        // Apenas força o reset do navegador se for erro crítico/conexão/login, não se for placa ausente
        if (tentativa <= 1 && !erro.message.includes('não encontrada')) {
            await resetarSessao();
            return await buscarPlacaNoSite(placa, tentativa + 1);
        }
        throw erro;

    } finally {
        // Retorna para a tela de lista mantendo a aba aberta para a próxima busca
        if (pagina && !pagina.isClosed()) {
            await pagina.goto(URL_LISTA_AVALIACOES, { waitUntil: 'domcontentloaded' }).catch(() => {});
        }
    }
}

function servirSemCache(res, caminhoArquivo) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(caminhoArquivo);
}

app.get('/', (req, res) => servirSemCache(res, path.join(__dirname, 'views', 'inicio.html')));
app.get(['/inicio', '/inicio.html'], (req, res) => servirSemCache(res, path.join(__dirname, 'views', 'inicio.html')));
app.get(['/avaliacao', '/avaliacao.html'], (req, res) => servirSemCache(res, path.join(__dirname, 'views', 'avaliacao.html')));
app.get(['/laudo', '/laudo.html'], (req, res) => servirSemCache(res, path.join(__dirname, 'views', 'laudo.html')));

app.get('/api/buscar-placa', (req, res) => {
    const { placa } = req.query;
    if (!placa) return res.status(400).json({ sucesso: false, erro: 'Informe a placa' });

    // Enfileira a consulta HTTP para execução sequencial
    executarNaFila(async () => {
        try {
            const dados = await buscarPlacaNoSite(placa);
            if (!res.headersSent) {
                res.json({ sucesso: true, dados });
            }
        } catch (err) {
            console.error('❌ Falha capturada na rota /api/buscar-placa:', err.message);
            if (!res.headersSent) {
                res.status(500).json({ sucesso: false, erro: err.message || 'Erro ao realizar a consulta' });
            }
        }
    });
});

app.listen(PORT, async () => {
    console.log(`🚀 Servidor rodando em: http://localhost:${PORT}`);
    console.log('⏳ Inicializando o robô em segundo plano...');
    
    try {
        await obterSessaoAutenticada();
        console.log('✅ Robô logado e pronto para consultas instantâneas!');
    } catch (e) {
        console.error('❌ Falha ao realizar pré-login na inicialização:', e.message);
    }
});