/* ==========================================================================
   ESTADO GLOBAL DA APLICAÇÃO
   ========================================================================== */
let currentPhotoIndex = 0;
let vehiclePhotos = [];
let avaliacoesDisponiveis = [];
const PLACEHOLDER_IMG = 'https://via.placeholder.com/800x600?text=Sem+Foto';

/* ==========================================================================
   NAVEGAÇÃO ENTRE ABAS E MODAIS DE AUTENTICAÇÃO
   ========================================================================== */
function openTab(evt, tabName) {
  const contents = document.querySelectorAll('.tab-content');
  contents.forEach(content => content.classList.remove('active'));

  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => item.classList.remove('active'));

  const targetTab = document.getElementById(tabName);
  if (targetTab) targetTab.classList.add('active');
  if (evt && evt.currentTarget) evt.currentTarget.classList.add('active');
}

function openAuthModal() {
  const modal = document.getElementById('modal-auth');
  const input = document.getElementById('admin-password');
  const errorMsg = document.getElementById('auth-error');

  if (!modal || !input) return;

  input.value = '';
  if (errorMsg) errorMsg.style.display = 'none';
  modal.classList.add('active');
  setTimeout(() => input.focus(), 100);
}

function closeAuthModal() {
  const modal = document.getElementById('modal-auth');
  if (modal) modal.classList.remove('active');
}

function verifyPassword() {
  const inputEl = document.getElementById('admin-password');
  const errorMsg = document.getElementById('auth-error');
  if (!inputEl) return;

  if (inputEl.value === '197119') {
    if (errorMsg) errorMsg.style.display = 'none';
    closeAuthModal();
    alert('Acesso Autorizado! Redirecionando para a área de conexão do Bot...');
  } else {
    if (errorMsg) errorMsg.style.display = 'block';
  }
}

/* ==========================================================================
   VALIDAÇÃO E TRATAMENTO DO INPUT DA PLACA
   ========================================================================== */
function showInputError(mensagem) {
  const input = document.getElementById('plate-input');
  const errorEl = document.getElementById('plate-error-msg');
  
  if (input) input.classList.add('input-error');
  if (errorEl) {
    errorEl.innerText = mensagem;
    errorEl.style.display = 'block';
  }
}

function clearInputError() {
  const input = document.getElementById('plate-input');
  const errorEl = document.getElementById('plate-error-msg');

  if (input) input.classList.remove('input-error');
  if (errorEl) {
    errorEl.innerText = '';
    errorEl.style.display = 'none';
  }
}

function handleInputClean() {
  const input = document.getElementById('plate-input');
  if (input) {
    input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    clearInputError();
  }
}

/* ==========================================================================
   GALERIA DE FOTOS & LIGHTBOX
   ========================================================================== */
function updatePhotoDisplay() {
  const photoImg = document.getElementById('main-photo');
  const counter = document.getElementById('photo-count');
  const lightboxImg = document.getElementById('lightbox-img');

  if (vehiclePhotos.length > 0) {
    const activeUrl = vehiclePhotos[currentPhotoIndex];
    if (photoImg) photoImg.src = activeUrl;
    if (lightboxImg) lightboxImg.src = activeUrl;
    if (counter) counter.innerText = `${currentPhotoIndex + 1} / ${vehiclePhotos.length}`;
  } else {
    if (photoImg) photoImg.src = PLACEHOLDER_IMG;
    if (lightboxImg) lightboxImg.src = PLACEHOLDER_IMG;
    if (counter) counter.innerText = '0 / 0';
  }
}

function prevPhoto(e) {
  if (e) e.stopPropagation();
  if (vehiclePhotos.length === 0) return;
  currentPhotoIndex = (currentPhotoIndex - 1 + vehiclePhotos.length) % vehiclePhotos.length;
  updatePhotoDisplay();
}

function nextPhoto(e) {
  if (e) e.stopPropagation();
  if (vehiclePhotos.length === 0) return;
  currentPhotoIndex = (currentPhotoIndex + 1) % vehiclePhotos.length;
  updatePhotoDisplay();
}

function openLightbox() {
  const mainImg = document.getElementById('main-photo');
  const lightbox = document.getElementById('lightbox-modal');
  const lightboxImg = document.getElementById('lightbox-img');

  if (mainImg && vehiclePhotos.length > 0 && lightbox) {
    if (lightboxImg) lightboxImg.src = vehiclePhotos[currentPhotoIndex];
    lightbox.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}

function closeLightbox(e) {
  if (!e || e.target.id === 'lightbox-modal' || e.target.closest('.btn-lightbox-close')) {
    const lightbox = document.getElementById('lightbox-modal');
    if (lightbox) {
      lightbox.classList.remove('active');
      document.body.style.overflow = 'auto';
    }
  }
}

/* ==========================================================================
   AUXILIARES E RENDERIZAÇÃO DE RESULTADOS
   ========================================================================== */
function parseDataBR(dataStr) {
  if (!dataStr || dataStr === '-' || dataStr === 'N/A') return 0;
  
  const cleanStr = dataStr.trim().replace('hs', '').replace('h', '');
  const parts = cleanStr.split(' ');
  const dataPart = parts[0];
  const horaPart = parts[1] || '00:00:00';
  
  const [dia, mes, ano] = dataPart.split('/').map(Number);
  if (!dia || !mes || !ano) return 0;

  const [hora, min, seg] = horaPart.split(':').map(Number);
  return new Date(ano, mes - 1, dia, hora || 0, min || 0, seg || 0).getTime();
}

function renderizarDadosAvaliacao(d) {
  const modelEl = document.getElementById('res-model');
  const subEl = document.getElementById('res-subtitle');
  if (modelEl) modelEl.innerText = d.versaoCarro || d.modelo || 'Modelo Não Informado';
  
  const ano = d.ano || 'N/I';
  const cambio = d.cambio || 'N/I';
  if (subEl) subEl.innerText = `Ano ${ano} • Câmbio: ${cambio}`;

  const badgeEl = document.getElementById('res-badge-status');
  const statusTexto = (d.status || '').toUpperCase();

  const eSolicitada = statusTexto.includes('SOLICITADA');
  const eAguardandoMesa = statusTexto.includes('AGUARDANDO MESA') || statusTexto.includes('AGUARDANDO');
  const eDesativada = statusTexto.includes('DESATIVADO');

  const gridEl = document.querySelector('.evaluation-grid');
  const mgmtEl = document.querySelector('.management-card');

  if (badgeEl) {
    if (eSolicitada || eAguardandoMesa || eDesativada) {
      badgeEl.className = 'badge-status badge-pending';

      if (eSolicitada) {
        badgeEl.innerText = 'AVALIAÇÃO SOLICITADA';
      } else if (eAguardandoMesa) {
        badgeEl.innerText = 'AVALIAÇÃO AGUARDANDO MESA';
      } else if (eDesativada) {
        badgeEl.innerText = 'AVALIAÇÃO DESATIVADA';
      }

      if (gridEl) gridEl.style.display = 'none';
      if (mgmtEl) mgmtEl.style.display = 'none';
    } else {
      badgeEl.className = 'badge-status';
      badgeEl.innerText = d.status || 'AVALIAÇÃO CONCLUÍDA';

      if (gridEl) gridEl.style.display = 'grid';
      if (mgmtEl) mgmtEl.style.display = 'flex';

      document.getElementById('res-plate').innerText = d.placa || '---';
      document.getElementById('res-km').innerText = d.quilometragem || 'N/I';
      document.getElementById('res-fuel').innerText = d.combustivel || 'N/I';
      document.getElementById('res-fipe').innerText = d.tabelaFipe || 'N/I';
      document.getElementById('res-paid-value').innerText = d.valorPago || 'R$ 0,00';
      document.getElementById('res-fipe-pct').innerText = d.porcentagemFipe || '---';
      document.getElementById('res-fipe-diff').innerText = d.diferencaFipe || '---';
      
      document.getElementById('res-company').innerText = d.loja || d.empresa || '---';
      document.getElementById('res-requester').innerText = d.solicitante || '---';
      document.getElementById('res-evaluator').innerText = d.vistoriador || d.avaliador || '---';
      document.getElementById('res-pricer').innerText = d.precificador || '---';
      
      if (Array.isArray(d.fotos) && d.fotos.length > 0) {
        vehiclePhotos = d.fotos;
      } else if (d.foto) {
        vehiclePhotos = [d.foto];
      } else {
        vehiclePhotos = [];
      }
      
      currentPhotoIndex = 0;
      updatePhotoDisplay();

      const obsTexto = d.observacoes && d.observacoes.trim() !== '' ? d.observacoes : 'Nenhuma observação registrada.';
      document.getElementById('res-obs').innerText = obsTexto;
    }
  }

  const resultsPanel = document.getElementById('evaluation-results');
  if (resultsPanel) {
    resultsPanel.style.display = 'flex';
    resultsPanel.scrollIntoView({ behavior: 'smooth' });
  }
}

/* ==========================================================================
   MODAL DE SELEÇÃO DE MÚLTIPLAS AVALIAÇÕES
   ========================================================================== */
function abrirModalSelecao(lista) {
  const listContainer = document.getElementById('selection-list');
  if (!listContainer) return;

  listContainer.innerHTML = '';

  lista.forEach((item, index) => {
    const card = document.createElement('div');
    card.style.cssText = `
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 0.9rem 1rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
    `;
    
    const dataMesaStr = item.dataMesa || item.data || 'Data N/I';
    const modeloStr = item.versaoCarro || item.modelo || 'Veículo';
    const statusStr = item.status || 'Avaliado';

    card.innerHTML = `
      <div>
        <div style="font-weight: 700; font-size: 0.95rem; color: #fff;">${modeloStr}</div>
        <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 3px;">
          Data (Mesa): <strong style="color: var(--yellow-primary);">${dataMesaStr}</strong>
        </div>
        <div style="font-size: 0.75rem; color: #a0a0ab; margin-top: 1px;">
          Status: ${statusStr}
        </div>
      </div>
      <button class="btn-confirm" style="padding: 0.4rem 0.9rem; font-size: 0.8rem;" onclick="selecionarAvaliacao(${index})">
        VISUALIZAR
      </button>
    `;
    listContainer.appendChild(card);
  });

  const modalSelection = document.getElementById('modal-selection');
  if (modalSelection) modalSelection.classList.add('active');
}

function closeSelectionModal() {
  const modalSelection = document.getElementById('modal-selection');
  if (modalSelection) modalSelection.classList.remove('active');
}

function selecionarAvaliacao(index) {
  const itemSelecionado = avaliacoesDisponiveis[index];
  closeSelectionModal();
  if (itemSelecionado) renderizarDadosAvaliacao(itemSelecionado);
}

/* ==========================================================================
   CONSULTA ASSÍNCRONA DE PLACA (API BACKEND)
   ========================================================================== */
async function handlePlateSearch() {
  const input = document.getElementById('plate-input');
  const btn = document.getElementById('btn-search');
  const resultsPanel = document.getElementById('evaluation-results');

  if (!input) return;

  const placa = input.value.trim().toUpperCase();
  clearInputError();

  const regexPlaca = /^[A-Z]{3}[0-9]{1}[A-Z0-9]{1}[0-9]{2}$/;

  if (!placa || placa.length !== 7 || !regexPlaca.test(placa)) {
    showInputError('Placa inválida! Utilize o padrão ABC1234 ou ABC1D23.');
    input.focus();
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerText = 'CONSULTANDO...';
  }
  if (resultsPanel) resultsPanel.style.display = 'none';

  try {
    const response = await fetch(`/api/buscar-placa?placa=${encodeURIComponent(placa)}`);
    
    if (!response.ok) {
      showInputError('Nenhuma avaliação encontrada para esta placa.');
      return;
    }

    const res = await response.json();

    if (!res.sucesso) {
      showInputError('Nenhuma avaliação encontrada para esta placa.');
      return;
    }

    let listaBruta = [];
    if (Array.isArray(res.dados)) {
      listaBruta = res.dados;
    } else if (Array.isArray(res.avaliacoes)) {
      listaBruta = res.avaliacoes;
    } else if (res.dados && typeof res.dados === 'object') {
      listaBruta = [res.dados];
    }

    if (listaBruta.length === 0) {
      showInputError('Nenhuma avaliação encontrada para esta placa.');
      return;
    }

    const avaliacoesValidas = listaBruta;

    avaliacoesValidas.sort((a, b) => {
      const timeA = parseDataBR(a.dataMesa || a.data);
      const timeB = parseDataBR(b.dataMesa || b.data);
      return timeB - timeA;
    });

    avaliacoesDisponiveis = avaliacoesValidas;

    if (avaliacoesValidas.length === 1) {
      renderizarDadosAvaliacao(avaliacoesValidas[0]);
    } else {
      abrirModalSelecao(avaliacoesValidas);
    }

  } catch (err) {
    showInputError('Nenhuma avaliação encontrada para esta placa.');
    console.error('Detalhe do Erro:', err);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = 'BUSCAR';
    }
  }
}

/* ==========================================================================
   EVENT LISTENERS & INICIALIZAÇÃO
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  // Input de Senha
  const adminPasswordInput = document.getElementById('admin-password');
  if (adminPasswordInput) {
    adminPasswordInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') verifyPassword();
    });
  }

  // Input de Placa
  const plateInput = document.getElementById('plate-input');
  if (plateInput) {
    plateInput.addEventListener('input', handleInputClean);
    plateInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handlePlateSearch();
    });
  }

  // Atalhos de Teclado (Esc e Setas)
  document.addEventListener('keydown', (e) => {
    const activeEl = document.activeElement;
    const isTyping = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');

    const lightbox = document.getElementById('lightbox-modal');
    const isLightboxActive = lightbox && lightbox.classList.contains('active');
    const authModal = document.getElementById('modal-auth');
    const selectionModal = document.getElementById('modal-selection');

    if (e.key === 'Escape') {
      if (isLightboxActive) closeLightbox();
      if (authModal && authModal.classList.contains('active')) closeAuthModal();
      if (selectionModal && selectionModal.classList.contains('active')) closeSelectionModal();
    }
    
    if (isTyping) return;

    const resultsPanel = document.getElementById('evaluation-results');
    const isResultsVisible = resultsPanel && resultsPanel.style.display === 'flex';

    if (isResultsVisible || isLightboxActive) {
      if (e.key === 'ArrowLeft') prevPhoto();
      if (e.key === 'ArrowRight') nextPhoto();
    }
  });

  // Gestos Swipe para Mobile
  let touchStartX = 0;
  let touchEndX = 0;

  function handleTouchStart(e) {
    touchStartX = e.changedTouches[0].screenX;
  }

  function handleTouchEnd(e) {
    touchEndX = e.changedTouches[0].screenX;
    if (touchEndX < touchStartX - 40) nextPhoto();
    if (touchEndX > touchStartX + 40) prevPhoto();
  }

  const frameEl = document.getElementById('main-photo-frame');
  if (frameEl) {
    frameEl.addEventListener('touchstart', handleTouchStart, { passive: true });
    frameEl.addEventListener('touchend', handleTouchEnd, { passive: true });
  }

  const lightboxEl = document.getElementById('lightbox-modal');
  if (lightboxEl) {
    lightboxEl.addEventListener('touchstart', handleTouchStart, { passive: true });
    lightboxEl.addEventListener('touchend', handleTouchEnd, { passive: true });
  }
});