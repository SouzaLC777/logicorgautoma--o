const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const AUTO_EMAIL = process.env.AUTO_EMAIL || '25gustavooliveira@gmail.com';
const AUTO_SENHA = process.env.AUTO_SENHA || '02019988GU';
const TOKEN_FILE = path.join(__dirname, 'sessao_autoavaliar.json');

let navegadorGlobal = null;
let paginaGlobal = null;
let loginEmAndamento = null;
let intervalKeepAlive = null;

// Função auxiliar para encontrar o executável do Chrome instalado no servidor/local
function obterCaminhoChrome() {
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        return process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    try {
        // Tenta resolver dinamicamente via API nativa do Puppeteer
        const puppeteerCore = require('puppeteer');
        if (puppeteerCore.executablePath) {
            const pathNatividades = puppeteerCore.executablePath();
            if (fs.existsSync(pathNatividades)) return pathNatividades;
        }
    } catch (e) {}

    // Locais padrão de cache no Render/Linux
    const possibilidadesCache = [
        '/opt/render/.cache/puppeteer',
        path.join(process.cwd(), '.cache', 'puppeteer'),
        path.join(require('os').homedir(), '.cache', 'puppeteer')
    ];

    for (const baseDir of possibilidadesCache) {
        const chromeDir = path.join(baseDir, 'chrome');
        if (fs.existsSync(chromeDir)) {
            const buscarExecutavelRecursivo = (dir) => {
                const itens = fs.readdirSync(dir);
                for (const item of itens) {
                    const fullPath = path.join(dir, item);
                    const stat = fs.statSync(fullPath);
                    if (stat.isDirectory()) {
                        const res = buscarExecutavelRecursivo(fullPath);
                        if (res) return res;
                    } else if (item === 'chrome' && !fullPath.endsWith('.js')) {
                        return fullPath;
                    }
                }
                return null;
            };

            const achou = buscarExecutavelRecursivo(chromeDir);
            if (achou) return achou;
        }
    }

    return null;
}

async function salvarTokenSessao(pagina) {
    try {
        const cookies = await pagina.cookies();
        const localStorageData = await pagina.evaluate(() => JSON.stringify(localStorage));
        const sessionStorageData = await pagina.evaluate(() => JSON.stringify(sessionStorage));

        const dadosAutenticacao = {
            criadoEm: new Date().toISOString(),
            cookies,
            localStorageData,
            sessionStorageData
        };

        fs.writeFileSync(TOKEN_FILE, JSON.stringify(dadosAutenticacao, null, 2));
        console.log('🔑 [AUTH] Token de sessão salvo com sucesso.');
    } catch (e) {
        console.error('❌ [AUTH] Erro ao salvar token:', e.message);
    }
}

async function aplicarTokenSessao(pagina) {
    try {
        if (!fs.existsSync(TOKEN_FILE)) return false;
        const conteudo = fs.readFileSync(TOKEN_FILE, 'utf8');
        if (!conteudo) return false;

        const { cookies, localStorageData, sessionStorageData } = JSON.parse(conteudo);

        if (cookies?.length) await pagina.setCookie(...cookies);

        await pagina.evaluate((ls, ss) => {
            try {
                if (ls) {
                    const parsedLs = JSON.parse(ls);
                    Object.entries(parsedLs).forEach(([k, v]) => localStorage.setItem(k, v));
                }
                if (ss) {
                    const parsedSs = JSON.parse(ss);
                    Object.entries(parsedSs).forEach(([k, v]) => sessionStorage.setItem(k, v));
                }
            } catch (err) {}
        }, localStorageData, sessionStorageData);

        return true;
    } catch (e) {
        return false;
    }
}

async function fecharModalAlertaSeExistir(pagina) {
    try {
        await pagina.evaluate(() => {
            const modaisEOverlays = document.querySelectorAll(`
                [data-pbz-popup], .pbz-pop-ov, #aa-popup-overlay,
                #ngdialog1, .ngdialog, .ngdialog-overlay, .modal-backdrop, .modal
            `);
            modaisEOverlays.forEach(el => el.remove());
            document.body.style.overflow = 'auto';
        });
        await new Promise(r => setTimeout(r, 300));
    } catch (e) {}
}

async function _executarLogin() {
    if (navegadorGlobal && paginaGlobal && !paginaGlobal.isClosed()) {
        try {
            const urlAtual = paginaGlobal.url();
            if (!urlAtual.includes('/login')) {
                return { navegador: navegadorGlobal, pagina: paginaGlobal };
            }
        } catch (e) {}
    }

    if (navegadorGlobal) {
        await navegadorGlobal.close().catch(() => {});
        navegadorGlobal = null;
        paginaGlobal = null;
    }

    const chromeExecutablePath = obterCaminhoChrome();
    if (chromeExecutablePath) {
        console.log(`🚀 [AUTH] Usando Chrome localizado em: ${chromeExecutablePath}`);
    } else {
        console.warn('⚠️ [AUTH] Executável customizado não encontrado. Usando inicialização padrão do Puppeteer.');
    }

    const launchOptions = {
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-extensions',
            '--disable-blink-features=AutomationControlled'
        ]
    };

    if (chromeExecutablePath) {
        launchOptions.executablePath = chromeExecutablePath;
    }

    navegadorGlobal = await puppeteer.launch(launchOptions);
    paginaGlobal = await navegadorGlobal.newPage();
    await paginaGlobal.setViewport({ width: 1280, height: 800 });

    // TENTA RESTAURAR SESSÃO POR TOKEN
    if (fs.existsSync(TOKEN_FILE)) {
        console.log('🔄 [AUTH] Carregando token de sessão existente em segundo plano...');
        try {
            await paginaGlobal.goto('https://apps.autoavaliar.com.br/login/app', { waitUntil: 'domcontentloaded', timeout: 20000 });
            await aplicarTokenSessao(paginaGlobal);
            await paginaGlobal.goto('https://apps.autoavaliar.com.br/usbi#/app/avaliacoes/avaliacoes/lista', { waitUntil: 'networkidle2', timeout: 25000 });

            await new Promise(r => setTimeout(r, 2000));

            if (!paginaGlobal.url().includes('/login')) {
                console.log('✅ [AUTH] Sessão restaurada com sucesso!');
                await fecharModalAlertaSeExistir(paginaGlobal);
                iniciarLoopManutencaoSessao();
                return { navegador: navegadorGlobal, pagina: paginaGlobal };
            } else {
                console.warn('⚠️ [AUTH] Token expirado ou inválido. Refazendo login com senha...');
                if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
            }
        } catch (e) {
            console.warn('⚠️ [AUTH] Falha ao tentar usar o token salvo:', e.message);
        }
    }

    // LOGIN FORMAL COM EMAIL E SENHA
    console.log('🔑 [AUTH] Realizando login no sistema via credenciais...');
    await paginaGlobal.goto('https://apps.autoavaliar.com.br/login/app', { waitUntil: 'networkidle2', timeout: 30000 });

    await paginaGlobal.evaluate((email, senha) => {
        const inputE = document.querySelector('#inputEmail, input[type="email"]');
        const inputS = document.querySelector('#inputPassword, input[type="password"]');
        if (inputE && inputS) {
            inputE.value = email;
            inputE.dispatchEvent(new Event('input', { bubbles: true }));
            inputE.dispatchEvent(new Event('change', { bubbles: true }));
            inputS.value = senha;
            inputS.dispatchEvent(new Event('input', { bubbles: true }));
            inputS.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }, AUTO_EMAIL, AUTO_SENHA);

    await paginaGlobal.evaluate(async () => {
        const btn = document.querySelector('button.g-recaptcha, button[type="submit"]');
        if (window.grecaptcha?.enterprise) {
            window.grecaptcha.enterprise.ready(() => {
                window.grecaptcha.enterprise.execute('6LdBJ1EnAAAAAJ4x-XjNdcRCfp8NSlfdAuHDckru', { action: 'login' })
                    .then(token => window.submitWithRecaptcha ? window.submitWithRecaptcha(token) : btn?.click());
            });
        } else {
            btn?.click();
        }
    });

    await new Promise(r => setTimeout(r, 6000));
    await fecharModalAlertaSeExistir(paginaGlobal);
    await salvarTokenSessao(paginaGlobal);

    iniciarLoopManutencaoSessao();
    return { navegador: navegadorGlobal, pagina: paginaGlobal };
}

function iniciarLoopManutencaoSessao() {
    if (intervalKeepAlive) clearInterval(intervalKeepAlive);

    intervalKeepAlive = setInterval(async () => {
        if (paginaGlobal && !paginaGlobal.isClosed()) {
            try {
                if (paginaGlobal.url().includes('/login')) {
                    console.log('⚠️ [AUTH-LOOP] Sessão deslogou. Efetuando novo login...');
                    await _executarLogin();
                } else {
                    await salvarTokenSessao(paginaGlobal);
                }
            } catch (err) {
                console.error('❌ [AUTH-LOOP] Erro na manutenção da sessão:', err.message);
            }
        }
    }, 5 * 60 * 1000);
}

async function obterSessaoAutenticada() {
    if (loginEmAndamento) {
        return await loginEmAndamento;
    }
    try {
        loginEmAndamento = _executarLogin();
        return await loginEmAndamento;
    } finally {
        loginEmAndamento = null;
    }
}

async function resetarSessao() {
    if (intervalKeepAlive) clearInterval(intervalKeepAlive);
    if (fs.existsSync(TOKEN_FILE)) {
        try { fs.unlinkSync(TOKEN_FILE); } catch (e) {}
    }
    if (navegadorGlobal) {
        await navegadorGlobal.close().catch(() => {});
        navegadorGlobal = null;
        paginaGlobal = null;
    }
}

module.exports = {
    obterSessaoAutenticada,
    resetarSessao,
    fecharModalAlertaSeExistir
};