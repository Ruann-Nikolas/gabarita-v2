/**
 * GABARITA — domínio (sem interface).
 *
 * Regras de negócio:
 * - RN01: '!' (rasura ou dupla marcação) invalida a questão; null é "em branco". Ambos não pontuam.
 * - RN02: Questões sem peso: conta-se a quantidade de acertos (1 a 60 questões).
 * - RN03: Só as respostas brutas são gravadas. Acertos, erros e percentuais são SEMPRE
 *         calculados a partir do gabarito atual (corrigir o gabarito atualiza as notas).
 * - RN04: Uma avaliação pode ter várias áreas (ex.: Biologia 1–13, Física 14–25). Cada
 *         área é um intervalo de questões, sem sobreposição. Todo resultado é calculado
 *         no total e por área.
 * - RN05: Cada avaliação tem sua lista de alunos; a correção é vinculada ao aluno (id).
 */
(function (raiz) {
    'use strict';

    const LIMITE_MAX_QUESTOES = 60;
    const OPCOES_VALIDAS = ['A', 'B', 'C', 'D', 'E'];
    const CODIGO_RASURA = '!';
    const VERSAO = 4;
    const KEY = 'gabarita_v4';
    const KEY_V3 = 'gabarita_acertos_v3';
    const KEY_COPIA = 'gabarita_v4_copia_corrompida';
    const KEY_ANTES_IMPORTAR = 'gabarita_v4_antes_de_importar';
    const MODELO_AREAS_GOIAS_40 = [
        { nome: 'Biologia', inicio: 1, fim: 13 },
        { nome: 'Física', inicio: 14, fim: 25 },
        { nome: 'Química', inicio: 26, fim: 40 }
    ];

    // ------------------------------------------------------------------
    // Utilitários puros
    // ------------------------------------------------------------------
    const clonar = (x) => JSON.parse(JSON.stringify(x));

    // Normaliza texto digitado. Não remove pontuação (D'Ávila, "Matemática & Física" são válidos):
    // XSS é evitado renderizando sempre com textContent; fórmulas de CSV, em campoCsv().
    function limparTexto(texto, maxLen = 60) {
        if (typeof texto !== 'string') return '';
        return texto
            .replace(/[\u0000-\u001f\u007f]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, maxLen);
    }

    // Campo CSV (separador ';'): neutraliza fórmulas (OWASP: = + - @ TAB CR) e escapa aspas.
    function campoCsv(valor) {
        if (typeof valor === 'number') return String(valor);
        let texto = valor === null || valor === undefined ? '' : String(valor);
        if (/^[=+\-@\t\r]/.test(texto)) texto = "'" + texto;
        if (/[;"\r\n]/.test(texto)) texto = '"' + texto.replace(/"/g, '""') + '"';
        return texto;
    }

    function nomeArquivoSeguro(titulo) {
        const base = String(titulo || '')
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        return base || 'avaliacao';
    }

    // Letra A–E, '!' (rasura/dupla) ou null (em branco)
    function normalizarResposta(valor) {
        if (OPCOES_VALIDAS.includes(valor)) return valor;
        if (valor === CODIGO_RASURA) return CODIGO_RASURA;
        return null;
    }

    // Lista de mensagens de erro; vazia se as áreas são válidas.
    // Permite questões fora de qualquer área, mas não sobreposição.
    function validarAreas(areas, total) {
        if (!Array.isArray(areas) || areas.length === 0) return ['Defina pelo menos uma área.'];
        const erros = [];
        const nomes = new Set();
        const usadaPor = Array(total).fill(null);
        areas.forEach((a, idx) => {
            const nome = limparTexto(a && a.nome, 30);
            const ini = Number(a && a.inicio);
            const fim = Number(a && a.fim);
            const rotulo = nome || `Área ${idx + 1}`;
            if (!nome) erros.push(`Área ${idx + 1}: informe o nome.`);
            else if (nomes.has(nome.toLowerCase())) erros.push(`Nome de área repetido: ${nome}.`);
            else nomes.add(nome.toLowerCase());

            if (!Number.isInteger(ini) || !Number.isInteger(fim) || ini < 1 || fim > total || ini > fim) {
                erros.push(`${rotulo}: informe um intervalo entre 1 e ${total} (início menor ou igual ao fim).`);
                return;
            }
            for (let q = ini; q <= fim; q++) {
                if (usadaPor[q - 1] !== null) {
                    erros.push(`${rotulo} se sobrepõe a ${usadaPor[q - 1]} na questão ${q}.`);
                    break;
                }
                usadaPor[q - 1] = rotulo;
            }
        });
        return erros;
    }

    function normalizarAreas(areas) {
        return areas.map((a, i) => ({
            id: i + 1,
            nome: limparTexto(a.nome, 30),
            inicio: Number(a.inicio),
            fim: Number(a.fim)
        }));
    }

    function contar(respostas, gabarito, de, ate) {
        let acertos = 0, erros = 0, brancos = 0, rasuras = 0;
        const divergencias = [];
        for (let i = de; i <= ate; i++) {
            const marcada = normalizarResposta(respostas[i]);
            const correta = gabarito[i] ?? null;
            const num = `Q${String(i + 1).padStart(2, '0')}`;
            if (marcada === null) {
                brancos++;
                divergencias.push(`${num}: em branco (correta ${correta})`);
            } else if (marcada === CODIGO_RASURA) {
                rasuras++;
                divergencias.push(`${num}: rasura/dupla marcação (correta ${correta})`);
            } else if (marcada === correta) {
                acertos++;
            } else {
                erros++;
                divergencias.push(`${num}: marcou ${marcada}, correta ${correta}`);
            }
        }
        const total = ate - de + 1;
        return { acertos, erros, brancos, rasuras, total, divergencias,
                 percentual: total > 0 ? Math.round((acertos / total) * 100) : 0 };
    }

    // Resultado total + por área
    function calcularResultado(respostas, gabarito, areas, total) {
        const geral = contar(respostas, gabarito, 0, total - 1);
        const porArea = (areas || []).map(a => {
            const r = contar(respostas, gabarito, a.inicio - 1, a.fim - 1);
            delete r.divergencias;
            return { id: a.id, nome: a.nome, inicio: a.inicio, fim: a.fim, ...r };
        });
        return { ...geral, porArea };
    }

    function novaAvaliacao(id, titulo = 'Nova avaliação', total = 10) {
        return {
            id,
            titulo: limparTexto(titulo, 50) || 'Nova avaliação',
            totalQuestoes: total,
            areas: [{ id: 1, nome: 'Geral', inicio: 1, fim: total }],
            gabarito: Array(total).fill(null),
            alunos: [],
            correcoes: {}
        };
    }

    // Saneia uma avaliação vinda do armazenamento ou de um backup. Nunca lança.
    function normalizarAvaliacao(bruta, id, avisos) {
        const a = bruta && typeof bruta === 'object' ? bruta : {};
        let total = a.totalQuestoes;
        if (!Number.isInteger(total) || total < 1 || total > LIMITE_MAX_QUESTOES) {
            if (total !== undefined) avisos.push('quantidade de questões inválida');
            total = 10;
        }
        const av = novaAvaliacao(id, typeof a.titulo === 'string' ? a.titulo : undefined, total);

        if (Array.isArray(a.areas)) {
            const candidatas = normalizarAreas(a.areas.filter(x => x && typeof x === 'object'));
            if (validarAreas(candidatas, total).length === 0) av.areas = candidatas;
            else avisos.push('áreas inválidas (substituídas por "Geral")');
        }

        if (Array.isArray(a.gabarito)) {
            if (a.gabarito.length !== total) avisos.push('gabarito com tamanho diferente');
            av.gabarito = Array.from({ length: total }, (_, i) => (OPCOES_VALIDAS.includes(a.gabarito[i]) ? a.gabarito[i] : null));
        }

        const idsUsados = new Set();
        const nomesUsados = new Set();
        let proximo = 1;
        if (Array.isArray(a.alunos)) {
            for (const al of a.alunos) {
                const nome = al && typeof al.nome === 'string' ? limparTexto(al.nome, 60) : '';
                if (!nome || nomesUsados.has(nome.toLowerCase())) { avisos.push('aluno inválido ou repetido ignorado'); continue; }
                let aid = Number.isInteger(al.id) && al.id > 0 ? al.id : null;
                if (aid === null || idsUsados.has(aid)) {
                    while (idsUsados.has(proximo)) proximo++;
                    aid = proximo;
                }
                idsUsados.add(aid);
                nomesUsados.add(nome.toLowerCase());
                av.alunos.push({ id: aid, nome });
            }
        }
        if (a.correcoes && typeof a.correcoes === 'object') {
            for (const [chave, resp] of Object.entries(a.correcoes)) {
                const aid = Number(chave);
                if (!idsUsados.has(aid) || !Array.isArray(resp)) { avisos.push('correção sem aluno correspondente ignorada'); continue; }
                av.correcoes[aid] = Array.from({ length: total }, (_, i) => normalizarResposta(resp[i]));
            }
        }
        return av;
    }

    function normalizarEstado(dados) {
        const avisos = [];
        const avaliacoes = [];
        if (dados && Array.isArray(dados.avaliacoes)) {
            const usados = new Set();
            let proximo = 1;
            for (const bruta of dados.avaliacoes) {
                let id = bruta && Number.isInteger(bruta.id) && bruta.id > 0 ? bruta.id : null;
                if (id === null || usados.has(id)) {
                    while (usados.has(proximo)) proximo++;
                    id = proximo;
                }
                usados.add(id);
                avaliacoes.push(normalizarAvaliacao(bruta, id, avisos));
            }
        }
        const pedido = dados ? dados.atualId : undefined;
        const atualId = avaliacoes.some(a => a.id === pedido) ? pedido : (avaliacoes[0] ? avaliacoes[0].id : null);
        return { avaliacoes, atualId, avisos };
    }

    // Converte o formato da versão anterior (uma única avaliação)
    function migrarV3(d) {
        const total = Number.isInteger(d && d.totalQuestoes) ? d.totalQuestoes : 10;
        const alunos = [];
        const correcoes = {};
        if (d && Array.isArray(d.alunosCorrigidos)) {
            d.alunosCorrigidos.forEach((al, i) => {
                alunos.push({ id: i + 1, nome: al && al.nome });
                correcoes[i + 1] = al && al.respostas;
            });
        }
        return normalizarEstado({
            avaliacoes: [{ id: 1, titulo: d && d.titulo, totalQuestoes: total, gabarito: d && d.gabaritoMestre, alunos, correcoes }],
            atualId: 1
        });
    }

    // ------------------------------------------------------------------
    // Gerenciador (estado + persistência)
    // ------------------------------------------------------------------
    class Gerenciador {
        #storage;
        #estado = { avaliacoes: [], atualId: null };
        #rascunho = null; // { alunoId, respostas, origem }
        #falhaNotificada = false;

        onErroPersistencia = null;
        avisoCarga = '';

        constructor(storage = raiz.localStorage) {
            this.#storage = storage;
            this.#carregar();
        }

        // ---- leitura -------------------------------------------------
        #atual() { return this.#estado.avaliacoes.find(a => a.id === this.#estado.atualId); }
        get avaliacao() { return clonar(this.#atual()); }
        get avaliacoes() { return this.#estado.avaliacoes.map(a => ({ id: a.id, titulo: a.titulo })); }
        get atualId() { return this.#estado.atualId; }
        get gabaritoEstaCompleto() {
            const a = this.#atual();
            return a.gabarito.length === a.totalQuestoes && a.gabarito.every(r => OPCOES_VALIDAS.includes(r));
        }
        get rascunho() { return this.#rascunho ? clonar(this.#rascunho) : null; }
        get rascunhoTemMarcacoes() { return !!this.#rascunho && this.#rascunho.respostas.some(r => r !== null); }

        // ---- avaliações ----------------------------------------------
        selecionarAvaliacao(id) {
            if (!this.#estado.avaliacoes.some(a => a.id === id)) throw new Error('Avaliação não encontrada.');
            this.#estado.atualId = id;
            this.#rascunho = null;
            this.salvarDados();
        }

        criarAvaliacao(titulo) {
            const id = this.#estado.avaliacoes.reduce((m, a) => Math.max(m, a.id), 0) + 1;
            this.#estado.avaliacoes.push(novaAvaliacao(id, titulo));
            this.#estado.atualId = id;
            this.#rascunho = null;
            this.salvarDados();
            return id;
        }

        excluirAvaliacao(id) {
            this.#estado.avaliacoes = this.#estado.avaliacoes.filter(a => a.id !== id);
            if (this.#estado.avaliacoes.length === 0) {
                this.#estado.avaliacoes.push(novaAvaliacao(1));
            }
            if (!this.#estado.avaliacoes.some(a => a.id === this.#estado.atualId)) {
                this.#estado.atualId = this.#estado.avaliacoes[0].id;
            }
            this.#rascunho = null;
            this.salvarDados();
        }

        definirTitulo(novo) {
            const limpo = limparTexto(novo, 50);
            if (limpo) { this.#atual().titulo = limpo; this.salvarDados(); }
        }

        // true se alterou; false se há correções e falta autorização para apagá-las
        alterarQuantidadeQuestoes(novaQtd, forcarLimpeza = false) {
            const qtd = Number.parseInt(novaQtd, 10);
            if (Number.isNaN(qtd) || qtd < 1 || qtd > LIMITE_MAX_QUESTOES) {
                throw new Error(`A quantidade de questões deve ser entre 1 e ${LIMITE_MAX_QUESTOES}.`);
            }
            const a = this.#atual();
            if (qtd === a.totalQuestoes) return true;
            if (Object.keys(a.correcoes).length > 0 && !forcarLimpeza) return false;
            if (forcarLimpeza) a.correcoes = {};

            const antigo = a.totalQuestoes;
            const gab = Array(qtd).fill(null);
            for (let i = 0; i < Math.min(antigo, qtd); i++) gab[i] = a.gabarito[i];
            a.gabarito = gab;
            a.totalQuestoes = qtd;

            // Área única que cobria tudo continua cobrindo tudo; as demais são ajustadas ao novo limite
            if (a.areas.length === 1 && a.areas[0].inicio === 1 && a.areas[0].fim === antigo) {
                a.areas[0].fim = qtd;
            } else {
                a.areas = a.areas
                    .filter(x => x.inicio <= qtd)
                    .map(x => ({ ...x, fim: Math.min(x.fim, qtd) }));
                if (a.areas.length === 0) a.areas = [{ id: 1, nome: 'Geral', inicio: 1, fim: qtd }];
            }
            this.#rascunho = null;
            this.salvarDados();
            return true;
        }

        definirAreas(areas) {
            const a = this.#atual();
            const lista = (Array.isArray(areas) ? areas : []).map(x => ({
                nome: limparTexto(x && x.nome, 30), inicio: Number(x && x.inicio), fim: Number(x && x.fim)
            }));
            const erros = validarAreas(lista, a.totalQuestoes);
            if (erros.length) throw new Error(erros.join(' '));
            a.areas = normalizarAreas(lista);
            this.salvarDados();
        }

        marcarGabarito(indice, letra) {
            const a = this.#atual();
            if (indice >= 0 && indice < a.totalQuestoes && OPCOES_VALIDAS.includes(letra)) {
                a.gabarito[indice] = letra;
                this.salvarDados();
            }
        }

        // ---- alunos --------------------------------------------------
        // Um nome por linha. Ignora linhas vazias e nomes que já existem.
        adicionarAlunos(texto) {
            const a = this.#atual();
            const existentes = new Set(a.alunos.map(x => x.nome.toLowerCase()));
            let proximo = a.alunos.reduce((m, x) => Math.max(m, x.id), 0) + 1;
            let adicionados = 0, ignorados = 0;
            for (const linha of String(texto || '').split(/\r?\n/)) {
                const nome = limparTexto(linha, 60);
                if (!nome) continue;
                if (existentes.has(nome.toLowerCase())) { ignorados++; continue; }
                existentes.add(nome.toLowerCase());
                a.alunos.push({ id: proximo++, nome });
                adicionados++;
            }
            if (adicionados) this.salvarDados();
            return { adicionados, ignorados };
        }

        removerAluno(id) {
            const a = this.#atual();
            a.alunos = a.alunos.filter(x => x.id !== id);
            delete a.correcoes[id];
            if (this.#rascunho && this.#rascunho.alunoId === id) this.#rascunho = null;
            this.salvarDados();
        }

        foiCorrigido(alunoId) { return Object.hasOwn(this.#atual().correcoes, alunoId); }

        // Próximo aluno sem correção depois de `aposId` (circular); null se todos corrigidos
        proximoAlunoPendente(aposId = null) {
            const a = this.#atual();
            const n = a.alunos.length;
            if (n === 0) return null;
            let inicio = a.alunos.findIndex(x => x.id === aposId) + 1; // -1 + 1 = 0 se não achar
            for (let k = 0; k < n; k++) {
                const al = a.alunos[(inicio + k) % n];
                if (!Object.hasOwn(a.correcoes, al.id)) return al.id;
            }
            return null;
        }

        // ---- correção (rascunho) -------------------------------------
        // `respostas` opcional: leitura automática. Sem ela, começa tudo em branco.
        iniciarRascunho(alunoId, respostas = null, origem = 'manual') {
            const a = this.#atual();
            if (!this.gabaritoEstaCompleto) {
                throw new Error('Preencha todas as questões do Gabarito antes de corrigir um aluno.');
            }
            if (!a.alunos.some(x => x.id === alunoId)) throw new Error('Aluno não encontrado.');
            // Leitura automática manda; sem ela, recorrigir parte da correção salva; senão, tudo em branco
            let base = [];
            if (Array.isArray(respostas)) base = respostas;
            else if (this.foiCorrigido(alunoId)) base = a.correcoes[alunoId];
            this.#rascunho = {
                alunoId,
                origem,
                respostas: Array.from({ length: a.totalQuestoes }, (_, i) => normalizarResposta(base[i]))
            };
        }

        descartarRascunho() { this.#rascunho = null; }

        // Tocar na opção já marcada deixa a questão em branco
        ajustarRascunho(indice, valor) {
            const r = this.#rascunho;
            if (!r || indice < 0 || indice >= r.respostas.length) return;
            if (!OPCOES_VALIDAS.includes(valor) && valor !== CODIGO_RASURA) return;
            r.respostas[indice] = r.respostas[indice] === valor ? null : valor;
        }

        resultadoRascunho() {
            const a = this.#atual();
            if (!this.#rascunho) return null;
            return calcularResultado(this.#rascunho.respostas, a.gabarito, a.areas, a.totalQuestoes);
        }

        salvarRascunho() {
            const a = this.#atual();
            const r = this.#rascunho;
            if (!r) throw new Error('Não há correção em andamento.');
            a.correcoes[r.alunoId] = [...r.respostas];
            const resultado = calcularResultado(r.respostas, a.gabarito, a.areas, a.totalQuestoes);
            const alunoId = r.alunoId;
            this.#rascunho = null;
            this.salvarDados();
            return { alunoId, ...resultado };
        }

        removerCorrecao(alunoId) {
            delete this.#atual().correcoes[alunoId];
            this.salvarDados();
        }

        resultadoDoAluno(alunoId) {
            const a = this.#atual();
            if (!Object.hasOwn(a.correcoes, alunoId)) return null;
            return calcularResultado(a.correcoes[alunoId], a.gabarito, a.areas, a.totalQuestoes);
        }

        // ---- estatísticas e exportação -------------------------------
        estatisticas() {
            const a = this.#atual();
            const corrigidos = a.alunos.filter(x => Object.hasOwn(a.correcoes, x.id));
            const n = corrigidos.length;
            const resultados = corrigidos.map(x => calcularResultado(a.correcoes[x.id], a.gabarito, a.areas, a.totalQuestoes));
            const soma = (f) => resultados.reduce((s, r) => s + f(r), 0);

            const areaDe = (q) => (a.areas.find(x => q >= x.inicio && q <= x.fim) || {}).nome || '';
            return {
                totalAlunos: a.alunos.length,
                corrigidos: n,
                mediaAcertos: n ? soma(r => r.acertos) / n : 0,
                mediaPercentual: n ? soma(r => r.percentual) / n : 0,
                porArea: a.areas.map((ar, idx) => {
                    const total = ar.fim - ar.inicio + 1;
                    const media = n ? soma(r => r.porArea[idx].acertos) / n : 0;
                    return { id: ar.id, nome: ar.nome, total, mediaAcertos: media, percentualMedio: n ? (media / total) * 100 : 0 };
                }),
                porQuestao: Array.from({ length: a.totalQuestoes }, (_, i) => {
                    const acertou = corrigidos.filter(x => a.correcoes[x.id][i] === a.gabarito[i]).length;
                    return { numero: i + 1, area: areaDe(i + 1), gabarito: a.gabarito[i],
                             percentualAcerto: n ? Math.round((acertou / n) * 100) : 0 };
                })
            };
        }

        csv() {
            const a = this.#atual();
            const comAreas = a.areas.length > 1;
            const cab = ['Avaliacao', 'Aluno', 'Total de Questoes', 'Acertos', 'Erros', 'Brancos', 'Rasuras', 'Aproveitamento (%)'];
            if (comAreas) a.areas.forEach(ar => cab.push(`${ar.nome} - Acertos (de ${ar.fim - ar.inicio + 1})`, `${ar.nome} - %`));
            cab.push('Respostas (. = branco, ! = rasura)');
            const linhas = [];
            for (const al of a.alunos) {
                const r = this.resultadoDoAluno(al.id);
                if (!r) continue;
                const linha = [a.titulo, al.nome, a.totalQuestoes, r.acertos, r.erros, r.brancos, r.rasuras, r.percentual];
                if (comAreas) r.porArea.forEach(p => linha.push(p.acertos, p.percentual));
                linha.push(a.correcoes[al.id].map(x => x ?? '.').join('-'));
                linhas.push(linha);
            }
            return '﻿' + [cab, ...linhas].map(l => l.map(campoCsv).join(';')).join('\r\n') + '\r\n';
        }

        exportarBackup() {
            return {
                app: 'gabarita', versao: VERSAO, exportadoEm: new Date().toISOString(),
                atualId: this.#estado.atualId, avaliacoes: clonar(this.#estado.avaliacoes)
            };
        }

        // Substitui TODOS os dados atuais. Guarda uma cópia dos dados anteriores antes de trocar.
        importarBackup(entrada) {
            let dados = entrada;
            if (typeof entrada === 'string') {
                try { dados = JSON.parse(entrada); } catch (e) { throw new Error('O arquivo não é um backup válido (JSON ilegível).'); }
            }
            if (!dados || dados.app !== 'gabarita' || !Array.isArray(dados.avaliacoes) || dados.avaliacoes.length === 0) {
                throw new Error('O arquivo não é um backup do Gabarita.');
            }
            const novo = normalizarEstado(dados);
            if (novo.avaliacoes.length === 0) throw new Error('O backup não contém avaliações válidas.');
            try {
                this.#storage.setItem(KEY_ANTES_IMPORTAR, JSON.stringify(this.exportarBackup()));
            } catch (e) { console.error('Não foi possível guardar cópia antes de importar:', e); }
            this.#estado = { avaliacoes: novo.avaliacoes, atualId: novo.atualId };
            this.#rascunho = null;
            this.salvarDados();
            return { avaliacoes: novo.avaliacoes.length, avisos: [...new Set(novo.avisos)] };
        }

        limparTudo() {
            this.#estado = { avaliacoes: [novaAvaliacao(1)], atualId: 1 };
            this.#rascunho = null;
            try { this.#storage.removeItem(KEY); } catch (e) { console.error('Erro ao limpar:', e); }
        }

        // ---- persistência --------------------------------------------
        salvarDados() {
            try {
                this.#storage.setItem(KEY, JSON.stringify({
                    versao: VERSAO, atualId: this.#estado.atualId, avaliacoes: this.#estado.avaliacoes
                }));
                this.#falhaNotificada = false;
                return true;
            } catch (err) {
                console.error('Erro ao salvar no navegador:', err);
                if (!this.#falhaNotificada) {
                    this.#falhaNotificada = true;
                    if (typeof this.onErroPersistencia === 'function') this.onErroPersistencia(err);
                }
                return false;
            }
        }

        #preservarCopia(bruto) {
            try { this.#storage.setItem(KEY_COPIA, bruto); } catch (e) { console.error('Cópia não preservada:', e); }
        }

        #padrao() { this.#estado = { avaliacoes: [novaAvaliacao(1)], atualId: 1 }; }

        #carregar() {
            let bruto, brutoV3;
            try {
                bruto = this.#storage.getItem(KEY);
                if (!bruto) brutoV3 = this.#storage.getItem(KEY_V3);
            } catch (err) {
                this.#padrao();
                this.avisoCarga = 'Não foi possível acessar o armazenamento do navegador. Os dados desta sessão não serão salvos.';
                return;
            }

            if (!bruto && brutoV3) {
                try {
                    const novo = migrarV3(JSON.parse(brutoV3));
                    this.#estado = { avaliacoes: novo.avaliacoes, atualId: novo.atualId };
                    this.avisoCarga = 'Dados da versão anterior foram importados para a nova versão.';
                    this.salvarDados();
                    return;
                } catch (err) {
                    this.#preservarCopia(brutoV3);
                    this.#padrao();
                    this.avisoCarga = 'Os dados da versão anterior estavam ilegíveis. Uma cópia foi preservada no navegador.';
                    return;
                }
            }
            if (!bruto) { this.#padrao(); return; }

            let dados = null;
            try { dados = JSON.parse(bruto); } catch (err) { dados = null; }
            if (!dados || typeof dados !== 'object' || !Array.isArray(dados.avaliacoes)) {
                this.#preservarCopia(bruto);
                this.#padrao();
                this.avisoCarga = 'Os dados salvos estavam ilegíveis e foram ignorados. Uma cópia foi preservada no navegador.';
                return;
            }
            const novo = normalizarEstado(dados);
            if (novo.avaliacoes.length === 0) { this.#preservarCopia(bruto); this.#padrao(); return; }
            this.#estado = { avaliacoes: novo.avaliacoes, atualId: novo.atualId };
            if (novo.avisos.length) {
                this.#preservarCopia(bruto);
                this.avisoCarga = 'Parte dos dados salvos estava inconsistente e foi corrigida. Uma cópia original foi preservada no navegador.';
            }
        }
    }

    const api = {
        Gerenciador, calcularResultado, validarAreas, campoCsv, limparTexto, nomeArquivoSeguro,
        normalizarResposta, MODELO_AREAS_GOIAS_40, OPCOES_VALIDAS, CODIGO_RASURA, LIMITE_MAX_QUESTOES
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    raiz.GabaritaDominio = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
