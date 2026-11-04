/**
 * GABARITA — interface. Liga o domínio (dominio.js) e o leitor (leitor.js) à tela.
 * Todo texto vindo do usuário é exibido com textContent (nunca innerHTML).
 */
(() => {
    const { Gerenciador, OPCOES_VALIDAS, CODIGO_RASURA, MODELO_AREAS_GOIAS_40, limparTexto, nomeArquivoSeguro } = globalThis.GabaritaDominio;
    const Leitor = globalThis.GabaritaLeitor;
    const MODELO = Leitor.MODELO_GOIAS_40;

    const app = new Gerenciador();
    const el = (id) => document.getElementById(id);

    let alunoSelecionado = null;
    let areasEditando = [];   // linhas do editor de áreas (texto digitado)
    let leitura = null;       // { img, ok, respostas, revisar, fracoes, quads, origem, revisados:Set }
    let cantos = [];          // toques do usuário ao marcar cantos manualmente

    // ------------------------------------------------------------------
    // Utilidades de interface
    // ------------------------------------------------------------------
    let temporizadorToast = null;
    function avisar(mensagem, tipo = 'info', duracaoMs = 3500) {
        const toast = el('toast');
        toast.textContent = mensagem;
        toast.className = `toast ${tipo}`;
        clearTimeout(temporizadorToast);
        temporizadorToast = setTimeout(() => toast.classList.add('oculto'), duracaoMs);
    }

    app.onErroPersistencia = () => {
        // Bloqueante de propósito: o usuário precisa saber que os dados NÃO estão sendo salvos
        alert('Atenção: não foi possível salvar os dados neste navegador (armazenamento cheio, bloqueado ou modo privado). ' +
              'O que você fizer a partir de agora pode ser perdido ao fechar a página. Salve um backup na aba Turma.');
    };

    const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;
    const fmt1 = (v) => v.toFixed(1).replace('.', ',');
    const fmtPct = (v) => `${Math.round(v)}%`;

    function baixar(nomeArquivo, conteudo, tipo) {
        const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
        const link = document.createElement('a');
        link.href = url;
        link.download = nomeArquivo;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function mostrarAba(idSecao) {
        document.querySelectorAll('.aba-btn').forEach(b => {
            const ativa = b.getAttribute('data-alvo') === idSecao;
            b.classList.toggle('ativa', ativa);
            b.setAttribute('aria-selected', String(ativa));
        });
        document.querySelectorAll('.secao').forEach(s => s.classList.toggle('ativa', s.id === idSecao));
        if (idSecao === 'secao-resultados') renderTurma(); // notas dependem do gabarito atual
        if (idSecao === 'secao-corrigir') renderCorrigir();
    }

    function nomeDoAluno(id) {
        const a = app.avaliacao.alunos.find(x => x.id === id);
        return a ? a.nome : '-';
    }

    // ------------------------------------------------------------------
    // Aba 1 — Configurar
    // ------------------------------------------------------------------
    function renderCabecalho() {
        const av = app.avaliacao;
        el('titulo-exame-header').textContent = av.titulo;
        el('input-titulo-prova').value = av.titulo;
        el('input-qtd-questoes').value = av.totalQuestoes;
        el('info-regra-contagem').textContent = `${av.totalQuestoes} questões, 1 acerto por questão (sem peso)`;
        const badge = el('badge-status-mestre');
        if (app.gabaritoEstaCompleto) {
            badge.textContent = `Gabarito pronto (${av.totalQuestoes}Q)`;
            badge.className = 'badge pronto';
        } else {
            badge.textContent = 'Gabarito pendente';
            badge.className = 'badge pendente';
        }
    }

    function renderAvaliacoes() {
        const sel = el('select-avaliacao');
        sel.textContent = '';
        app.avaliacoes.forEach(a => {
            const o = document.createElement('option');
            o.value = String(a.id);
            o.textContent = a.titulo;
            sel.appendChild(o);
        });
        sel.value = String(app.atualId);
    }

    function carregarAreasEditando() {
        areasEditando = app.avaliacao.areas.map(a => ({ nome: a.nome, inicio: String(a.inicio), fim: String(a.fim) }));
    }

    function renderAreas() {
        const caixa = el('lista-areas');
        caixa.textContent = '';
        areasEditando.forEach((a, idx) => {
            const linha = document.createElement('div');
            linha.className = 'linha-area';

            const nome = document.createElement('input');
            nome.type = 'text'; nome.value = a.nome; nome.maxLength = 30; nome.placeholder = 'Nome da área';
            nome.setAttribute('aria-label', `Nome da área ${idx + 1}`);
            nome.addEventListener('input', () => { areasEditando[idx].nome = nome.value; });

            const campoNumero = (chave, rotulo) => {
                const wrap = document.createElement('label');
                wrap.className = 'campo-numero';
                const span = document.createElement('span');
                span.textContent = rotulo;
                const inp = document.createElement('input');
                inp.type = 'number'; inp.min = '1'; inp.max = '60'; inp.inputMode = 'numeric'; inp.value = a[chave];
                inp.setAttribute('aria-label', `${rotulo === 'de' ? 'Primeira' : 'Última'} questão da área ${idx + 1}`);
                inp.addEventListener('input', () => { areasEditando[idx][chave] = inp.value; });
                wrap.appendChild(span); wrap.appendChild(inp);
                return wrap;
            };

            const rm = document.createElement('button');
            rm.type = 'button'; rm.className = 'btn-excluir-item'; rm.textContent = '✕';
            rm.setAttribute('aria-label', `Remover área ${idx + 1}`);
            rm.disabled = areasEditando.length === 1;
            rm.addEventListener('click', () => { areasEditando.splice(idx, 1); renderAreas(); });

            linha.append(nome, campoNumero('inicio', 'de'), campoNumero('fim', 'até'), rm);
            caixa.appendChild(linha);
        });
    }

    function mostrarErroAreas(msg) {
        const p = el('erro-areas');
        p.textContent = msg || '';
        p.classList.toggle('oculto', !msg);
    }

    function renderGradeMestre() {
        const container = el('grade-mestre');
        const rolagem = container.scrollTop;
        container.textContent = '';
        const av = app.avaliacao;
        for (let i = 0; i < av.totalQuestoes; i++) {
            container.appendChild(criarLinhaQuestao(i, OPCOES_VALIDAS, (letra) => {
                app.marcarGabarito(i, letra);
                renderGradeMestre();
                renderCabecalho();
            }, (letra) => (av.gabarito[i] === letra ? 'selecionada' : '')));
        }
        container.scrollTop = rolagem;
        const pre = av.gabarito.filter(r => OPCOES_VALIDAS.includes(r)).length;
        el('progresso-preenchimento').textContent = `${pre} de ${av.totalQuestoes} questões preenchidas`;
    }

    function criarLinhaQuestao(indice, simbolos, aoClicar, classeDoSimbolo, revisar = false) {
        const linha = document.createElement('div');
        linha.className = 'linha-questao' + (revisar ? ' revisar' : '');
        const num = document.createElement('span');
        num.className = 'num-questao';
        num.textContent = String(indice + 1).padStart(2, '0');
        const bolas = document.createElement('div');
        bolas.className = 'opcoes-bolinhas';
        simbolos.forEach(simbolo => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'bolinha-opcao';
            btn.textContent = simbolo;
            const classe = classeDoSimbolo(simbolo);
            if (classe) btn.classList.add(...classe.split(' '));
            btn.setAttribute('aria-label', `Questão ${indice + 1}, alternativa ${simbolo === CODIGO_RASURA ? 'rasura ou dupla marcação' : simbolo}`);
            btn.setAttribute('aria-pressed', String(['selecionada', 'acerto', 'erro', 'rasura'].some(c => btn.classList.contains(c))));
            btn.addEventListener('click', () => aoClicar(simbolo));
            bolas.appendChild(btn);
        });
        linha.append(num, bolas);
        if (revisar) {
            const marca = document.createElement('span');
            marca.className = 'marca-revisar';
            marca.textContent = 'conferir';
            linha.appendChild(marca);
        }
        return linha;
    }

    function ligarConfigurar() {
        el('select-avaliacao').addEventListener('change', (e) => {
            app.selecionarAvaliacao(Number(e.target.value));
            trocouAvaliacao();
        });

        el('btn-nova-avaliacao').addEventListener('click', () => {
            app.criarAvaliacao('Nova avaliação');
            trocouAvaliacao();
            const campo = el('input-titulo-prova');
            campo.focus(); campo.select();
            avisar('Avaliação criada. Dê um nome e configure as áreas e o gabarito.', 'sucesso');
        });

        el('btn-excluir-avaliacao').addEventListener('click', () => {
            const av = app.avaliacao;
            const n = Object.keys(av.correcoes).length;
            if (!confirm(`Excluir a avaliação "${av.titulo}"? Isso apaga o gabarito, ${plural(av.alunos.length, 'aluno', 'alunos')} e ${plural(n, 'correção', 'correções')}. Não dá para desfazer.`)) return;
            app.excluirAvaliacao(av.id);
            trocouAvaliacao();
            avisar('Avaliação excluída.', 'sucesso');
        });

        el('input-titulo-prova').addEventListener('change', (e) => {
            app.definirTitulo(e.target.value);
            renderCabecalho();
            renderAvaliacoes();
        });

        el('btn-aplicar-qtd').addEventListener('click', () => {
            try {
                const valor = el('input-qtd-questoes').value;
                let ok = app.alterarQuantidadeQuestoes(valor, false);
                if (!ok && confirm('Já existem alunos corrigidos. Alterar a quantidade de questões apaga as correções (a lista de alunos é mantida). Deseja continuar?')) {
                    ok = app.alterarQuantidadeQuestoes(valor, true);
                }
                if (ok) {
                    descartarCorrecaoEmAndamento();
                    carregarAreasEditando();
                    mostrarErroAreas('');
                    avisar(`Avaliação com ${app.avaliacao.totalQuestoes} questões.`, 'sucesso');
                }
            } catch (erro) {
                avisar(erro.message, 'erro', 4500);
            } finally {
                renderTudo(); // o campo volta a refletir o valor realmente aplicado
            }
        });

        el('btn-add-area').addEventListener('click', () => {
            const total = app.avaliacao.totalQuestoes;
            const ultimo = areasEditando.reduce((m, a) => Math.max(m, Number(a.fim) || 0), 0);
            const inicio = Math.min(ultimo + 1, total);
            areasEditando.push({ nome: '', inicio: String(inicio), fim: String(total) });
            renderAreas();
            const campos = el('lista-areas').querySelectorAll('input[type=text]');
            campos[campos.length - 1].focus();
        });

        el('btn-modelo-goias').addEventListener('click', () => {
            try {
                if (app.avaliacao.totalQuestoes !== 40) {
                    let ok = app.alterarQuantidadeQuestoes(40, false);
                    if (!ok && confirm('Esse modelo tem 40 questões. Já existem correções e elas serão apagadas (a lista de alunos é mantida). Continuar?')) {
                        ok = app.alterarQuantidadeQuestoes(40, true);
                    }
                    if (!ok) return;
                    descartarCorrecaoEmAndamento();
                }
                app.definirAreas(MODELO_AREAS_GOIAS_40);
                carregarAreasEditando();
                mostrarErroAreas('');
                avisar('Áreas do modelo aplicadas: Biologia 1–13, Física 14–25, Química 26–40.', 'sucesso', 4500);
            } catch (erro) {
                mostrarErroAreas(erro.message);
            } finally {
                renderTudo();
            }
        });

        el('btn-salvar-areas').addEventListener('click', () => {
            try {
                app.definirAreas(areasEditando);
                carregarAreasEditando();
                mostrarErroAreas('');
                renderAreas();
                renderCorrigir();
                avisar('Áreas salvas.', 'sucesso');
            } catch (erro) {
                mostrarErroAreas(erro.message);
            }
        });

        el('btn-salvar-mestre').addEventListener('click', () => {
            const total = app.avaliacao.totalQuestoes;
            if (!app.gabaritoEstaCompleto) {
                avisar(`Marque todas as ${total} questões do gabarito antes de continuar.`, 'erro', 4500);
                return;
            }
            const salvas = JSON.stringify(app.avaliacao.areas.map(a => [a.nome, a.inicio, a.fim]));
            const editando = JSON.stringify(areasEditando.map(a => [limparTexto(a.nome, 30), Number(a.inicio), Number(a.fim)]));
            if (salvas !== editando) {
                avisar('Gabarito completo, mas há alterações nas áreas que ainda não foram salvas.', 'erro', 5000);
                return;
            }
            avisar(`Gabarito com ${total} questões pronto. Vá para a aba Corrigir.`, 'sucesso');
        });
    }

    function trocouAvaliacao() {
        alunoSelecionado = null;
        leitura = null;
        fecharPainelCantos();
        carregarAreasEditando();
        mostrarErroAreas('');
        renderTudo();
    }

    // ------------------------------------------------------------------
    // Aba 2 — Corrigir
    // ------------------------------------------------------------------
    function leituraDisponivel() {
        return app.avaliacao.totalQuestoes === MODELO.questoes;
    }

    function mostrarAvisoLeitura(texto, tipo = 'info') {
        const p = el('aviso-leitura');
        p.textContent = texto || '';
        p.className = `aviso-leitura ${tipo}` + (texto ? '' : ' oculto');
    }

    function renderCorrigir() {
        const av = app.avaliacao;
        const sel = el('select-aluno');
        sel.textContent = '';
        if (!av.alunos.some(a => a.id === alunoSelecionado)) alunoSelecionado = app.proximoAlunoPendente() ?? (av.alunos[0] ? av.alunos[0].id : null);

        if (av.alunos.length === 0) {
            const o = document.createElement('option');
            o.textContent = 'Nenhum aluno na lista';
            sel.appendChild(o);
        }
        av.alunos.forEach(a => {
            const o = document.createElement('option');
            o.value = String(a.id);
            o.textContent = (app.foiCorrigido(a.id) ? '✓ ' : '') + a.nome;
            sel.appendChild(o);
        });
        if (alunoSelecionado !== null) sel.value = String(alunoSelecionado);
        sel.disabled = av.alunos.length === 0;

        const corrigidos = Object.keys(av.correcoes).length;
        el('progresso-correcao').textContent = av.alunos.length ? `${corrigidos} de ${av.alunos.length} corrigidos` : '';

        const pronto = alunoSelecionado !== null && app.gabaritoEstaCompleto;
        const foto = pronto && leituraDisponivel();
        el('input-foto').disabled = !foto;
        el('btn-foto').classList.toggle('desativado', !foto);
        el('btn-foto').setAttribute('aria-disabled', String(!foto));
        el('btn-manual').disabled = !pronto;
        el('dica-foto').textContent = leituraDisponivel()
            ? 'Fotografe o cartão inteiro, de cima, com as duas tabelas visíveis e boa luz.'
            : `A leitura por foto existe só para o cartão de ${MODELO.questoes} questões (modelo Goiás). Esta avaliação tem ${av.totalQuestoes}: marque as respostas à mão.`;

        renderPainel();
    }

    function descartarCorrecaoEmAndamento() {
        app.descartarRascunho();
        leitura = null;
        mostrarAvisoLeitura('');
        el('btn-cantos-manual').classList.add('oculto');
        fecharPainelCantos();
    }

    function ligarCorrigir() {
        el('select-aluno').addEventListener('change', (e) => {
            if (app.rascunhoTemMarcacoes && !confirm('Há uma correção em andamento. Descartar e trocar de aluno?')) {
                e.target.value = String(alunoSelecionado);
                return;
            }
            descartarCorrecaoEmAndamento();
            alunoSelecionado = Number(e.target.value);
            renderCorrigir();
        });

        el('btn-add-aluno-rapido').addEventListener('click', () => {
            const campo = el('input-novo-aluno');
            const nome = limparTexto(campo.value);
            if (!nome) { avisar('Digite o nome ou código do aluno.', 'erro'); campo.focus(); return; }
            const r = app.adicionarAlunos(nome);
            const existente = app.avaliacao.alunos.find(a => a.nome.toLowerCase() === nome.toLowerCase());
            if (r.ignorados) avisar(`"${nome}" já está na lista. Selecionado.`, 'info');
            descartarCorrecaoEmAndamento();
            alunoSelecionado = existente.id;
            campo.value = '';
            renderCorrigir();
            renderTurma();
        });
        el('input-novo-aluno').addEventListener('keydown', (e) => { if (e.key === 'Enter') el('btn-add-aluno-rapido').click(); });

        // Rótulos funcionando como botão (teclado)
        ['btn-foto', 'btn-importar-backup'].forEach(id => {
            el(id).addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el(id).click(); }
            });
        });
        el('btn-foto').addEventListener('click', (e) => { if (el('input-foto').disabled) e.preventDefault(); });

        el('btn-manual').addEventListener('click', () => {
            try {
                if (app.rascunhoTemMarcacoes && !confirm('Já há uma correção em andamento. Recomeçar?')) return;
                leitura = null;
                mostrarAvisoLeitura('');
                el('btn-cantos-manual').classList.add('oculto');
                app.iniciarRascunho(alunoSelecionado);
                renderPainel();
                el('painel-conferencia').scrollIntoView({ behavior: 'smooth', block: 'start' });
            } catch (erro) {
                avisar(erro.message, 'erro', 4500);
            }
        });

        el('input-foto').addEventListener('change', aoEscolherFoto);
        el('btn-cantos-manual').addEventListener('click', abrirPainelCantos);
        el('btn-fechar-cantos').addEventListener('click', fecharPainelCantos);
        el('btn-refazer-cantos').addEventListener('click', () => { cantos = []; desenharCantos(); });
        el('canvas-cantos').addEventListener('click', aoTocarCantos);

        el('btn-confirmar-nota').addEventListener('click', () => {
            const r0 = app.rascunho;
            if (!r0) return;
            const pend = pendentesDeRevisao();
            if (pend.length && !confirm(`${plural(pend.length, 'questão em destaque ainda não foi conferida', 'questões em destaque ainda não foram conferidas')}. Salvar assim mesmo?`)) return;
            const r = app.salvarRascunho();
            const nome = nomeDoAluno(r.alunoId);
            leitura = null;
            mostrarAvisoLeitura('');
            el('btn-cantos-manual').classList.add('oculto');
            const proximo = app.proximoAlunoPendente(r.alunoId);
            alunoSelecionado = proximo ?? r.alunoId;
            renderCorrigir();
            renderTurma();
            window.scrollTo({ top: 0, behavior: 'smooth' });
            avisar(proximo === null
                ? `Salvo: ${nome} — ${r.acertos}/${r.total} acertos. Todos os alunos da lista foram corrigidos.`
                : `Salvo: ${nome} — ${r.acertos}/${r.total} acertos. Próximo: ${nomeDoAluno(proximo)}.`, 'sucesso', 4500);
        });

        el('btn-cancelar-correcao').addEventListener('click', () => {
            if (app.rascunhoTemMarcacoes && !confirm('Descartar as marcações desta correção?')) return;
            descartarCorrecaoEmAndamento();
            renderPainel();
        });
    }

    // ---- foto -----------------------------------------------------------
    async function carregarImagem(arquivo) {
        let bmp;
        try {
            bmp = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
        } catch (e) {
            bmp = await createImageBitmap(arquivo);
        }
        const k = Leitor.LADO_MAIOR / Math.max(bmp.width, bmp.height);
        const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bmp, 0, 0, w, h);
        if (bmp.close) bmp.close();
        return ctx.getImageData(0, 0, w, h);
    }

    async function aoEscolherFoto(e) {
        const arquivo = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!arquivo || alunoSelecionado === null) return;
        if (app.rascunhoTemMarcacoes && !confirm('Já há uma correção em andamento. Substituir pela leitura desta foto?')) return;
        mostrarAvisoLeitura('Lendo o cartão…');
        el('btn-cantos-manual').classList.add('oculto');
        try {
            const img = await carregarImagem(arquivo);
            leitura = { img };
            await new Promise(r => setTimeout(r, 30)); // deixa a mensagem aparecer antes do processamento
            executarLeitura(null);
        } catch (erro) {
            console.error(erro);
            leitura = null;
            mostrarAvisoLeitura('Não consegui abrir essa foto. Tente tirar outra.', 'erro');
        }
    }

    function executarLeitura(pontos) {
        const img = leitura.img;
        const r = Leitor.lerCartao(img, MODELO, pontos ? { cantos: pontos } : {});
        el('btn-cantos-manual').classList.remove('oculto');
        if (!r.ok) {
            leitura = { img };
            app.descartarRascunho();
            renderPainel();
            mostrarAvisoLeitura(`${r.motivo} Fotografe de novo, de cima e com o cartão inteiro na imagem, ou marque os cantos da tabela manualmente.`, 'erro');
            return;
        }
        if (r.suspeita) r.revisar.fill(true); // leitura duvidosa: nenhuma questão passa sem conferência
        leitura = { img, ...r, revisados: new Set() };
        app.iniciarRascunho(alunoSelecionado, r.respostas, 'foto');
        const qtdRev = r.revisar.filter(Boolean).length;
        if (r.suspeita || r.aproximada) {
            mostrarAvisoLeitura('Atenção: a leitura pode estar desalinhada com o cartão. Confira todas as questões ou refaça a foto (de cima, cartão inteiro, boa luz) ou os cantos da tabela.', 'erro');
        } else mostrarAvisoLeitura(qtdRev
            ? `Cartão lido. ${plural(qtdRev, 'questão precisa', 'questões precisam')} da sua conferência (em destaque).`
            : 'Cartão lido. Nenhuma questão em dúvida; mesmo assim, confira o resultado antes de salvar.', qtdRev ? 'info' : 'ok');
        renderPainel(true);
        el('painel-conferencia').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ---- cantos manuais -------------------------------------------------
    function abrirPainelCantos() {
        if (!leitura || !leitura.img) return;
        cantos = [];
        el('painel-cantos').classList.remove('oculto');
        el('texto-cantos').textContent = 'Toque nos 4 cantos externos da tabela da ESQUERDA (a que começa na questão 01), em qualquer ordem.';
        const c = el('canvas-cantos');
        c.width = leitura.img.width; c.height = leitura.img.height;
        desenharCantos();
        c.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function fecharPainelCantos() {
        cantos = [];
        el('painel-cantos').classList.add('oculto');
    }

    function desenharCantos() {
        if (!leitura || !leitura.img) return;
        const c = el('canvas-cantos');
        const ctx = c.getContext('2d');
        ctx.putImageData(leitura.img, 0, 0);
        ctx.lineWidth = 5; ctx.strokeStyle = '#ff1744'; ctx.fillStyle = '#ff1744';
        cantos.forEach((p, i) => {
            ctx.beginPath(); ctx.arc(p[0], p[1], 14, 0, Math.PI * 2); ctx.fill();
            if (i > 0) { ctx.beginPath(); ctx.moveTo(cantos[i - 1][0], cantos[i - 1][1]); ctx.lineTo(p[0], p[1]); ctx.stroke(); }
        });
        el('texto-cantos').textContent = cantos.length < 4
            ? `Toque nos 4 cantos externos da tabela da ESQUERDA (a que começa na questão 01). Marcados: ${cantos.length} de 4.`
            : 'Cantos marcados.';
    }

    function aoTocarCantos(e) {
        if (cantos.length >= 4) return;
        const c = el('canvas-cantos');
        const r = c.getBoundingClientRect();
        cantos.push([(e.clientX - r.left) * (c.width / r.width), (e.clientY - r.top) * (c.height / r.height)]);
        desenharCantos();
        if (cantos.length === 4) {
            const pontos = cantos.slice();
            mostrarAvisoLeitura('Lendo o cartão com os cantos marcados…');
            setTimeout(() => { fecharPainelCantos(); executarLeitura(pontos); }, 250);
        }
    }

    // ---- painel de conferência -----------------------------------------
    function pendentesDeRevisao() {
        const r = app.rascunho;
        if (!r || r.origem !== 'foto' || !leitura || !leitura.revisar) return [];
        return leitura.revisar.map((v, i) => (v && !leitura.revisados.has(i) ? i : -1)).filter(i => i >= 0);
    }

    function renderPainel(redesenharFoto = false) {
        const painel = el('painel-conferencia');
        const rasc = app.rascunho;
        if (!rasc) { painel.classList.add('oculto'); return; }
        painel.classList.remove('oculto');

        const av = app.avaliacao;
        const res = app.resultadoRascunho();
        const pend = new Set(pendentesDeRevisao());

        el('res-nome-aluno').textContent = nomeDoAluno(rasc.alunoId);
        el('res-acertos-valor').textContent = `${res.acertos} / ${av.totalQuestoes}`;
        el('pill-acertos').textContent = `${plural(res.acertos, 'acerto', 'acertos')} (${res.percentual}%)`;
        el('pill-erros').textContent = plural(res.erros, 'erro', 'erros');
        el('pill-brancos').textContent = `${res.brancos} em branco`;
        el('pill-rasuras').textContent = plural(res.rasuras, 'rasura', 'rasuras');

        const ul = el('lista-res-areas');
        ul.textContent = '';
        if (res.porArea.length > 1) {
            res.porArea.forEach(p => {
                const li = document.createElement('li');
                const n = document.createElement('span'); n.textContent = p.nome;
                const v = document.createElement('strong'); v.textContent = `${p.acertos}/${p.total}`;
                const pc = document.createElement('span'); pc.className = 'texto-suave'; pc.textContent = `${p.percentual}%`;
                li.append(n, v, pc);
                ul.appendChild(li);
            });
        }

        const aviso = el('contador-revisar');
        aviso.textContent = pend.size ? `${plural(pend.size, 'questão', 'questões')} para conferir (marcadas em laranja). Compare com a foto.` : '';
        aviso.classList.toggle('oculto', pend.size === 0);

        const grade = el('grade-aluno');
        const rolagem = grade.scrollTop;
        grade.textContent = '';
        for (let i = 0; i < av.totalQuestoes; i++) {
            grade.appendChild(criarLinhaQuestao(i, [...OPCOES_VALIDAS, CODIGO_RASURA], (simbolo) => {
                app.ajustarRascunho(i, simbolo);
                if (leitura && leitura.revisados) leitura.revisados.add(i);
                renderPainel();
            }, (simbolo) => {
                const marcada = rasc.respostas[i], correta = av.gabarito[i];
                if (marcada === simbolo) {
                    if (simbolo === CODIGO_RASURA) return 'rasura';
                    return simbolo === correta ? 'acerto' : 'erro';
                }
                return simbolo === correta ? 'gabarito-correto' : '';
            }, pend.has(i)));
        }
        grade.scrollTop = rolagem;

        el('log-divergencias').textContent = res.divergencias.length === 0
            ? `Todas as ${av.totalQuestoes} questões estão corretas.`
            : 'Divergências: ' + res.divergencias.join(' • ');

        const det = el('detalhe-leitura');
        const comFoto = rasc.origem === 'foto' && leitura && leitura.ok;
        det.classList.toggle('oculto', !comFoto);
        if (comFoto && redesenharFoto) desenharLeituraSobreFoto();
    }

    function desenharLeituraSobreFoto() {
        for (let t = 0; t < 2; t++) {
            const n = Leitor.normalizarTabela(leitura.img, leitura.quads[t], MODELO);
            const cv = el(`canvas-tab-${t}`);
            cv.width = n.width; cv.height = n.height;
            const ctx = cv.getContext('2d');
            ctx.putImageData(new ImageData(n.data, n.width, n.height), 0, 0);
            ctx.lineWidth = 5;
            for (let i = 0; i < MODELO.linhas; i++) {
                const q = t * MODELO.linhas + i;
                const resp = leitura.respostas[q];
                if (resp && resp !== CODIGO_RASURA) {
                    const c = Leitor.centroBolha(MODELO, t, i, MODELO.opcoes.indexOf(resp));
                    ctx.strokeStyle = leitura.revisar[q] ? '#ff9800' : '#00c853';
                    ctx.beginPath(); ctx.arc(c.x, c.y, c.r + 4, 0, Math.PI * 2); ctx.stroke();
                } else if (resp === CODIGO_RASURA || leitura.revisar[q]) {
                    const c = Leitor.centroBolha(MODELO, t, i, 2);
                    ctx.strokeStyle = '#ff1744';
                    ctx.strokeRect(c.x - 110, c.y - 18, 220, 36);
                }
            }
        }
    }

    // ------------------------------------------------------------------
    // Aba 3 — Turma
    // ------------------------------------------------------------------
    function criarBarra(rotuloEsq, rotuloDir, percentual) {
        const li = document.createElement('li');
        const linha = document.createElement('div');
        linha.className = 'linha-stat';
        const a = document.createElement('span'); a.textContent = rotuloEsq;
        const b = document.createElement('strong'); b.textContent = rotuloDir;
        linha.append(a, b);
        const barra = document.createElement('div');
        barra.className = 'barra';
        const i = document.createElement('i');
        i.style.width = `${Math.max(0, Math.min(100, percentual))}%`;
        barra.appendChild(i);
        li.append(linha, barra);
        return li;
    }

    function renderTurma() {
        const av = app.avaliacao;
        const est = app.estatisticas();
        el('contador-alunos').textContent = av.alunos.length;
        el('metrica-corrigidos').textContent = `${est.corrigidos}/${est.totalAlunos}`;
        el('metrica-questoes').textContent = av.totalQuestoes;
        el('metrica-media').textContent = est.corrigidos ? fmt1(est.mediaAcertos) : '0,0';

        const ulAreas = el('lista-stats-areas');
        ulAreas.textContent = '';
        el('card-stats-areas').classList.toggle('oculto', av.areas.length < 2);
        if (est.corrigidos === 0) {
            const li = document.createElement('li');
            li.className = 'lista-vazia';
            li.textContent = 'Corrija pelo menos um aluno para ver o desempenho por área.';
            ulAreas.appendChild(li);
        } else {
            est.porArea.forEach(a => ulAreas.appendChild(
                criarBarra(a.nome, `${fmt1(a.mediaAcertos)} de ${a.total} · ${fmtPct(a.percentualMedio)}`, a.percentualMedio)));
        }

        const ulQ = el('lista-stats-questoes');
        ulQ.textContent = '';
        if (est.corrigidos === 0) {
            const li = document.createElement('li');
            li.className = 'lista-vazia';
            li.textContent = 'Ainda sem correções.';
            ulQ.appendChild(li);
        } else {
            est.porQuestao.forEach(q => ulQ.appendChild(criarBarra(
                `Q${String(q.numero).padStart(2, '0')}${av.areas.length > 1 && q.area ? ' · ' + q.area : ''} (gab. ${q.gabarito ?? '-'})`,
                `${q.percentualAcerto}%`, q.percentualAcerto)));
        }

        const ul = el('lista-alunos-salvos');
        ul.textContent = '';
        if (av.alunos.length === 0) {
            const vazio = document.createElement('li');
            vazio.className = 'lista-vazia';
            vazio.textContent = 'Nenhum aluno na lista. Adicione acima, um nome por linha.';
            ul.appendChild(vazio);
            return;
        }
        av.alunos.forEach(aluno => {
            const r = app.resultadoDoAluno(aluno.id);
            const li = document.createElement('li');
            li.className = 'item-nota';

            const info = document.createElement('div');
            const nome = document.createElement('strong'); nome.textContent = aluno.nome;
            const resumo = document.createElement('small');
            if (!r) {
                resumo.textContent = 'Ainda não corrigido';
            } else {
                const partes = [`${plural(r.erros, 'erro', 'erros')}`, `${r.brancos} em branco`, plural(r.rasuras, 'rasura', 'rasuras'), `${r.percentual}%`];
                resumo.textContent = partes.join(' • ');
            }
            info.append(nome, resumo);
            if (r && r.porArea.length > 1) {
                const areas = document.createElement('small');
                areas.className = 'resumo-areas';
                areas.textContent = r.porArea.map(p => `${p.nome} ${p.acertos}/${p.total}`).join(' · ');
                info.appendChild(areas);
            }

            const acoes = document.createElement('div');
            acoes.className = 'acoes-item';
            const badge = document.createElement('span');
            badge.className = 'nota-badge' + (r ? '' : ' vazio');
            badge.textContent = r ? `${r.acertos}/${av.totalQuestoes}` : '—';
            badge.title = 'Acertos';

            const corrigir = document.createElement('button');
            corrigir.type = 'button'; corrigir.className = 'btn-mini';
            corrigir.textContent = r ? 'Revisar' : 'Corrigir';
            corrigir.setAttribute('aria-label', `${r ? 'Revisar' : 'Corrigir'} ${aluno.nome}`);
            corrigir.addEventListener('click', () => {
                if (!app.gabaritoEstaCompleto) { avisar('Preencha o gabarito antes de corrigir.', 'erro', 4500); return; }
                if (app.rascunhoTemMarcacoes && !confirm('Há uma correção em andamento. Descartar e abrir este aluno?')) return;
                descartarCorrecaoEmAndamento();
                alunoSelecionado = aluno.id;
                mostrarAba('secao-corrigir');
            });

            const excluir = document.createElement('button');
            excluir.type = 'button'; excluir.className = 'btn-excluir-item';
            excluir.textContent = '✕'; excluir.title = 'Excluir aluno';
            excluir.setAttribute('aria-label', `Excluir ${aluno.nome}`);
            excluir.addEventListener('click', () => {
                if (!confirm(`Excluir "${aluno.nome}" da lista${r ? ' e apagar a correção dele' : ''}?`)) return;
                if (alunoSelecionado === aluno.id) { descartarCorrecaoEmAndamento(); alunoSelecionado = null; }
                app.removerAluno(aluno.id);
                renderTurma();
                renderCorrigir();
            });

            acoes.append(badge, corrigir, excluir);
            li.append(info, acoes);
            ul.appendChild(li);
        });
    }

    function ligarTurma() {
        el('btn-add-alunos').addEventListener('click', () => {
            const campo = el('textarea-alunos');
            const r = app.adicionarAlunos(campo.value);
            if (r.adicionados === 0 && r.ignorados === 0) { avisar('Digite pelo menos um nome.', 'erro'); campo.focus(); return; }
            campo.value = '';
            renderTurma();
            renderCorrigir();
            avisar(`${plural(r.adicionados, 'aluno adicionado', 'alunos adicionados')}${r.ignorados ? ` (${plural(r.ignorados, 'repetido ignorado', 'repetidos ignorados')})` : ''}.`, r.adicionados ? 'sucesso' : 'info');
        });

        el('btn-exportar-csv').addEventListener('click', () => {
            if (app.estatisticas().corrigidos === 0) { avisar('Não há alunos corrigidos para exportar.', 'erro'); return; }
            baixar(`resultados_${nomeArquivoSeguro(app.avaliacao.titulo)}.csv`, app.csv(), 'text/csv;charset=utf-8;');
        });

        el('btn-exportar-backup').addEventListener('click', () => {
            const dia = new Date().toISOString().slice(0, 10);
            baixar(`gabarita_backup_${dia}.json`, JSON.stringify(app.exportarBackup(), null, 1), 'application/json');
            avisar('Backup salvo no seu aparelho.', 'sucesso');
        });

        el('input-importar-backup').addEventListener('change', async (e) => {
            const arquivo = e.target.files && e.target.files[0];
            e.target.value = '';
            if (!arquivo) return;
            try {
                const texto = await arquivo.text();
                if (!confirm('Restaurar o backup substitui TODOS os dados atuais deste aparelho (uma cópia dos dados atuais fica guardada no navegador). Continuar?')) return;
                const r = app.importarBackup(texto);
                alunoSelecionado = null;
                descartarCorrecaoEmAndamento();
                carregarAreasEditando();
                renderTudo();
                avisar(`Backup restaurado: ${plural(r.avaliacoes, 'avaliação', 'avaliações')}.${r.avisos.length ? ' Alguns dados inconsistentes foram corrigidos.' : ''}`, 'sucesso', 5000);
            } catch (erro) {
                avisar(erro.message, 'erro', 6000);
            }
        });

        el('btn-limpar-dados').addEventListener('click', () => {
            if (!confirm('Apagar TODAS as avaliações, alunos e correções deste aparelho? Salve um backup antes se precisar dos dados. Não dá para desfazer.')) return;
            app.limparTudo();
            alunoSelecionado = null;
            descartarCorrecaoEmAndamento();
            carregarAreasEditando();
            renderTudo();
            mostrarAba('secao-mestre');
            avisar('Todos os dados foram apagados.', 'sucesso');
        });
    }

    // ------------------------------------------------------------------
    // Início
    // ------------------------------------------------------------------
    function renderTudo() {
        renderAvaliacoes();
        renderCabecalho();
        renderAreas();
        renderGradeMestre();
        renderCorrigir();
        renderTurma();
    }

    function ligarAbas() {
        document.querySelectorAll('.aba-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const destino = btn.getAttribute('data-alvo');
                if (destino === 'secao-corrigir' && !app.gabaritoEstaCompleto) {
                    avisar(`Preencha todas as ${app.avaliacao.totalQuestoes} questões do gabarito antes de corrigir alunos.`, 'erro', 4500);
                    return;
                }
                mostrarAba(destino);
            });
        });
    }

    carregarAreasEditando();
    ligarAbas();
    ligarConfigurar();
    ligarCorrigir();
    ligarTurma();
    renderTudo();
    if (app.avisoCarga) avisar(app.avisoCarga, 'erro', 8000);
})();
