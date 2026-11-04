// Execute com: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../dominio.js');
const { Gerenciador, calcularResultado, validarAreas, campoCsv, limparTexto, nomeArquivoSeguro } = D;

function criarStorage(inicial = {}, { falharAoGravar = false } = {}) {
    const dados = { ...inicial };
    return {
        dados,
        getItem: (k) => (k in dados ? dados[k] : null),
        setItem: (k, v) => { if (falharAoGravar) throw new Error('cota excedida'); dados[k] = String(v); },
        removeItem: (k) => { delete dados[k]; }
    };
}

// App com gabarito e alunos prontos
function prepararApp(gabarito, nomes = [], storage = criarStorage()) {
    const app = new Gerenciador(storage);
    app.alterarQuantidadeQuestoes(gabarito.length);
    gabarito.forEach((l, i) => app.marcarGabarito(i, l));
    if (nomes.length) app.adicionarAlunos(nomes.join('\n'));
    return app;
}
function corrigir(app, nome, marcas) {
    const aluno = app.avaliacao.alunos.find(a => a.nome === nome);
    app.iniciarRascunho(aluno.id);
    Object.entries(marcas).forEach(([i, v]) => app.ajustarRascunho(Number(i), v));
    return app.salvarRascunho();
}

// ---------- cálculo ----------
test('calcularResultado separa acertos, erros, brancos e rasuras', () => {
    const areas = [{ id: 1, nome: 'Geral', inicio: 1, fim: 5 }];
    const r = calcularResultado(['A', 'B', null, '!', 'E'], ['A', 'A', 'C', 'D', 'E'], areas, 5);
    assert.deepEqual({ a: r.acertos, e: r.erros, b: r.brancos, r: r.rasuras, p: r.percentual }, { a: 2, e: 1, b: 1, r: 1, p: 40 });
});

test('resultado por área soma o resultado geral', () => {
    const gab = ['A', 'B', 'C', 'D', 'E', 'A'];
    const areas = [{ id: 1, nome: 'Bio', inicio: 1, fim: 2 }, { id: 2, nome: 'Fis', inicio: 3, fim: 6 }];
    const r = calcularResultado(['A', 'X', 'C', null, '!', 'A'], gab, areas, 6);
    assert.deepEqual(r.porArea.map(p => [p.nome, p.acertos, p.total, p.percentual]), [['Bio', 1, 2, 50], ['Fis', 2, 4, 50]]);
    assert.equal(r.porArea.reduce((s, p) => s + p.acertos, 0), r.acertos);
    assert.equal(r.porArea[1].brancos, 1);
    assert.equal(r.porArea[1].rasuras, 1);
});

test('branco não conta como acerto mesmo com gabarito nulo', () => {
    const r = calcularResultado([null, null], [null, null], [], 2);
    assert.equal(r.acertos, 0);
    assert.equal(r.brancos, 2);
});

// ---------- áreas ----------
test('validarAreas: aceita lacunas, recusa sobreposição, nome vazio/repetido e intervalo inválido', () => {
    assert.deepEqual(validarAreas([{ nome: 'A', inicio: 1, fim: 3 }, { nome: 'B', inicio: 5, fim: 10 }], 10), []);
    assert.match(validarAreas([{ nome: 'A', inicio: 1, fim: 5 }, { nome: 'B', inicio: 5, fim: 10 }], 10).join(' '), /sobrepõe/);
    assert.match(validarAreas([{ nome: '', inicio: 1, fim: 5 }], 10).join(' '), /nome/);
    assert.match(validarAreas([{ nome: 'A', inicio: 1, fim: 2 }, { nome: 'a', inicio: 3, fim: 4 }], 10).join(' '), /repetido/);
    assert.match(validarAreas([{ nome: 'A', inicio: 0, fim: 2 }], 10).join(' '), /intervalo/);
    assert.match(validarAreas([{ nome: 'A', inicio: 1, fim: 11 }], 10).join(' '), /intervalo/);
    assert.match(validarAreas([{ nome: 'A', inicio: 4, fim: 2 }], 10).join(' '), /intervalo/);
    assert.match(validarAreas([], 10).join(' '), /pelo menos/);
});

test('modelo Goiás 40: Biologia 1–13, Física 14–25, Química 26–40', () => {
    const app = new Gerenciador(criarStorage());
    app.alterarQuantidadeQuestoes(40);
    app.definirAreas(D.MODELO_AREAS_GOIAS_40);
    const a = app.avaliacao;
    assert.deepEqual(a.areas.map(x => [x.nome, x.inicio, x.fim]), [['Biologia', 1, 13], ['Física', 14, 25], ['Química', 26, 40]]);
});

test('definirAreas inválidas lançam erro e não alteram nada', () => {
    const app = prepararApp(['A', 'B', 'C', 'D']);
    assert.throws(() => app.definirAreas([{ nome: 'X', inicio: 1, fim: 9 }]), /intervalo/);
    assert.equal(app.avaliacao.areas[0].nome, 'Geral');
});

test('área única "Geral" acompanha a quantidade de questões; áreas múltiplas são ajustadas', () => {
    const app = new Gerenciador(criarStorage());
    app.alterarQuantidadeQuestoes(20);
    assert.deepEqual(app.avaliacao.areas.map(a => [a.inicio, a.fim]), [[1, 20]]);
    app.definirAreas([{ nome: 'A', inicio: 1, fim: 10 }, { nome: 'B', inicio: 11, fim: 20 }]);
    app.alterarQuantidadeQuestoes(15);
    assert.deepEqual(app.avaliacao.areas.map(a => [a.nome, a.inicio, a.fim]), [['A', 1, 10], ['B', 11, 15]]);
    app.alterarQuantidadeQuestoes(8);
    assert.deepEqual(app.avaliacao.areas.map(a => [a.nome, a.inicio, a.fim]), [['A', 1, 8]]);
});

// ---------- fluxo de correção ----------
test('correção por aluno, notas por área e recálculo ao corrigir o gabarito (RN03)', () => {
    const app = prepararApp(['A', 'B', 'C', 'D'], ['Ana']);
    app.definirAreas([{ nome: 'P1', inicio: 1, fim: 2 }, { nome: 'P2', inicio: 3, fim: 4 }]);
    const alunoId = app.avaliacao.alunos[0].id;
    app.iniciarRascunho(alunoId);
    assert.deepEqual(app.rascunho.respostas, [null, null, null, null]);
    app.ajustarRascunho(0, 'A'); app.ajustarRascunho(1, 'C'); app.ajustarRascunho(2, 'C');
    app.ajustarRascunho(2, 'C'); // tocar de novo desmarca
    app.ajustarRascunho(3, '!');
    const r = app.salvarRascunho();
    assert.deepEqual({ a: r.acertos, e: r.erros, b: r.brancos, x: r.rasuras }, { a: 1, e: 1, b: 1, x: 1 });
    assert.deepEqual(r.porArea.map(p => p.acertos), [1, 0]);

    // Só respostas brutas são gravadas (nada de acertos/erros calculados)
    assert.deepEqual(app.avaliacao.correcoes[alunoId], ['A', 'C', null, '!']);
    assert.equal(JSON.stringify(app.avaliacao).includes('acertos'), false);

    app.marcarGabarito(1, 'C');
    assert.equal(app.resultadoDoAluno(alunoId).acertos, 2);
});

test('não inicia correção com gabarito incompleto ou aluno inexistente', () => {
    const app = new Gerenciador(criarStorage());
    app.adicionarAlunos('Ana');
    assert.throws(() => app.iniciarRascunho(1), /Gabarito/);
    const app2 = prepararApp(['A']);
    assert.throws(() => app2.iniciarRascunho(99), /Aluno não encontrado/);
});

test('leitura automática pré-preenche o rascunho; recorrigir parte da correção salva', () => {
    const app = prepararApp(['A', 'B'], ['Ana']);
    const id = app.avaliacao.alunos[0].id;
    app.iniciarRascunho(id, ['A', '!'], 'foto');
    assert.deepEqual(app.rascunho.respostas, ['A', '!']);
    assert.equal(app.rascunho.origem, 'foto');
    app.salvarRascunho();
    app.iniciarRascunho(id); // sem leitura: começa da correção salva
    assert.deepEqual(app.rascunho.respostas, ['A', '!']);
});

test('alunos: nomes duplicados (sem diferenciar maiúsculas) são ignorados; ids únicos', () => {
    const app = new Gerenciador(criarStorage());
    const r = app.adicionarAlunos("Ana Souza\n\n  ana souza \nD'Ávila\r\nBruno");
    assert.deepEqual(r, { adicionados: 3, ignorados: 1 });
    const ids = app.avaliacao.alunos.map(a => a.id);
    assert.equal(new Set(ids).size, 3);
    assert.ok(app.avaliacao.alunos.some(a => a.nome === "D'Ávila"));
});

test('removerAluno apaga também a correção; ids novos não reutilizam ids antigos em uso', () => {
    const app = prepararApp(['A'], ['A1', 'A2']);
    corrigir(app, 'A1', { 0: 'A' });
    const id1 = app.avaliacao.alunos[0].id;
    app.removerAluno(id1);
    assert.equal(app.avaliacao.alunos.length, 1);
    assert.deepEqual(Object.keys(app.avaliacao.correcoes), []);
    app.adicionarAlunos('A3');
    const ids = app.avaliacao.alunos.map(a => a.id);
    assert.equal(new Set(ids).size, 2);
});

test('proximoAlunoPendente segue a ordem da lista e dá a volta', () => {
    const app = prepararApp(['A'], ['A1', 'A2', 'A3']);
    const [a1, a2, a3] = app.avaliacao.alunos.map(a => a.id);
    assert.equal(app.proximoAlunoPendente(), a1);
    corrigir(app, 'A1', {});
    assert.equal(app.proximoAlunoPendente(a1), a2);
    corrigir(app, 'A3', {});
    assert.equal(app.proximoAlunoPendente(a1), a2);
    assert.equal(app.proximoAlunoPendente(a3), a2); // volta ao início
    corrigir(app, 'A2', {});
    assert.equal(app.proximoAlunoPendente(a2), null);
});

// ---------- avaliações ----------
test('várias avaliações na mesma turma: gabarito e correções próprios, alunos compartilhados', () => {
    const app = prepararApp(['A', 'B'], ['Ana']);
    app.definirTitulo('Prova 1');
    const id1 = app.atualId;
    const id2 = app.criarAvaliacao('Prova 2');
    assert.equal(app.avaliacao.alunos.length, 1); // mesma turma
    assert.equal(app.gabaritoEstaCompleto, false);
    app.selecionarAvaliacao(id1);
    assert.equal(app.avaliacao.alunos.length, 1);
    assert.deepEqual(app.avaliacoes.map(a => a.titulo), ['Prova 1', 'Prova 2']);
    app.excluirAvaliacao(id1);
    assert.equal(app.atualId, id2);
    app.excluirAvaliacao(id2);
    assert.equal(app.avaliacoes.length, 1); // nunca fica sem avaliação
});

test('alterar quantidade com correções exige autorização e preserva gabarito', () => {
    const app = prepararApp(['A', 'B', 'C'], ['Ana']);
    corrigir(app, 'Ana', { 0: 'A' });
    assert.equal(app.alterarQuantidadeQuestoes(2), false);
    assert.equal(app.avaliacao.totalQuestoes, 3);
    assert.equal(app.alterarQuantidadeQuestoes(2, true), true);
    assert.deepEqual(app.avaliacao.gabarito, ['A', 'B']);
    assert.deepEqual(app.avaliacao.correcoes, {});
    assert.equal(app.avaliacao.alunos.length, 1); // a lista de alunos permanece
    assert.throws(() => app.alterarQuantidadeQuestoes(61), /entre 1 e 60/);
    assert.throws(() => app.alterarQuantidadeQuestoes('abc'), /entre 1 e 60/);
});

// ---------- estatísticas e CSV ----------
test('estatísticas: médias por área e taxa de acerto por questão', () => {
    const app = prepararApp(['A', 'B', 'C', 'D'], ['Ana', 'Bia', 'Caio']);
    app.definirAreas([{ nome: 'P1', inicio: 1, fim: 2 }, { nome: 'P2', inicio: 3, fim: 4 }]);
    corrigir(app, 'Ana', { 0: 'A', 1: 'B', 2: 'C', 3: 'D' });  // 4
    corrigir(app, 'Bia', { 0: 'A', 1: 'E' });                  // 1
    const e = app.estatisticas();
    assert.equal(e.corrigidos, 2);
    assert.equal(e.totalAlunos, 3);
    assert.equal(e.mediaAcertos, 2.5);
    assert.deepEqual(e.porArea.map(a => [a.nome, a.mediaAcertos, a.percentualMedio]), [['P1', 1.5, 75], ['P2', 1, 50]]);
    assert.deepEqual(e.porQuestao.map(q => q.percentualAcerto), [100, 50, 50, 50]);
    assert.equal(e.porQuestao[2].area, 'P2');
});

test('CSV: colunas por área, só corrigidos, fórmulas neutralizadas, BOM e CRLF', () => {
    const app = prepararApp(['A', 'B'], ['=cmd', 'Bia']);
    app.definirAreas([{ nome: 'Bio', inicio: 1, fim: 1 }, { nome: 'Fís', inicio: 2, fim: 2 }]);
    app.definirTitulo('Prova; "X"');
    corrigir(app, '=cmd', { 0: 'A', 1: '!' });
    const csv = app.csv();
    const linhas = csv.split('\r\n');
    assert.ok(csv.startsWith('﻿'));
    assert.equal(linhas.length, 3); // cabeçalho + 1 corrigido + vazio final
    assert.match(linhas[0], /Bio - Acertos \(de 1\);Bio - %;Fís - Acertos \(de 1\);Fís - %/);
    assert.equal(linhas[1], 'Matéria 1;Turma 1;"Prova; ""X""";1;\'=cmd;2;1;0;0;1;50;1;100;0;0;A-!');
    assert.match(linhas[0], /Materia;Turma;Avaliacao;Numero;Aluno;/);
});

test('CSV de avaliação com uma área não repete colunas por área', () => {
    const app = prepararApp(['A'], ['Ana']);
    corrigir(app, 'Ana', { 0: 'A' });
    assert.doesNotMatch(app.csv().split('\r\n')[0], /Geral/);
});

test('campoCsv e utilitários de texto', () => {
    assert.equal(campoCsv('=1+1'), "'=1+1");
    assert.equal(campoCsv('@soma'), "'@soma");
    assert.ok(campoCsv('\t=cmd').startsWith("'"));
    assert.equal(campoCsv('Ana; "Lu"'), '"Ana; ""Lu"""');
    assert.equal(limparTexto("  D'Ávila   &  Silva  "), "D'Ávila & Silva");
    assert.equal(nomeArquivoSeguro('Matemática & Física - 2º ano/B'), 'matematica_fisica_2_ano_b');
    assert.equal(nomeArquivoSeguro('???'), 'avaliacao');
});

// ---------- persistência, backup e migração ----------
test('persiste e recarrega tudo (avaliações, áreas, alunos, correções)', () => {
    const storage = criarStorage();
    const app = prepararApp(['A', 'B', 'C'], ['Ana'], storage);
    app.definirAreas([{ nome: 'X', inicio: 1, fim: 3 }]);
    corrigir(app, 'Ana', { 0: 'A', 1: 'B' });
    const app2 = new Gerenciador(storage);
    assert.deepEqual(app2.avaliacao, app.avaliacao);
    assert.equal(app2.avisoCarga, '');
});

test('migra o formato v3 (acertos gravados são descartados e recalculados)', () => {
    const v3 = {
        titulo: 'Prova X', totalQuestoes: 3, gabaritoMestre: ['A', 'B', 'C'],
        alunosCorrigidos: [{ id: 1730000000000, nome: 'Bia', acertos: 99, erros: 99, rasuras: 99, percentual: 99, respostas: ['A', '!', null] }]
    };
    const storage = criarStorage({ gabarita_acertos_v3: JSON.stringify(v3) });
    const app = new Gerenciador(storage);
    assert.match(app.avisoCarga, /versão anterior/);
    const a = app.avaliacao;
    assert.equal(a.titulo, 'Prova X');
    assert.equal(a.areas[0].nome, 'Geral');
    const r = app.resultadoDoAluno(a.alunos[0].id);
    assert.deepEqual({ ac: r.acertos, b: r.brancos, x: r.rasuras }, { ac: 1, b: 1, x: 1 });
    assert.ok(storage.dados.gabarita_v5);
    assert.ok(storage.dados.gabarita_acertos_v3, 'não apaga os dados antigos');
});

test('JSON corrompido é preservado em cópia e não derruba o app', () => {
    const storage = criarStorage({ gabarita_v4: '{quebrado' });
    const app = new Gerenciador(storage);
    assert.match(app.avisoCarga, /ilegíveis/);
    assert.equal(storage.dados.gabarita_v4_copia_corrompida, '{quebrado');
    assert.equal(app.avaliacao.totalQuestoes, 10);
});

test('dados parcialmente inválidos são saneados, avisados e preservados', () => {
    const sujo = {
        atualId: 1,
        avaliacoes: [{
            id: 1, totalQuestoes: 2, gabarito: ['A', 'Z'],
            areas: [{ nome: 'X', inicio: 1, fim: 9 }],
            alunos: [{ id: 1, nome: 'Ok' }, { id: 1, nome: 'Repetido id' }, { nome: '' }, null],
            correcoes: { 1: ['A', 'X'], 7: ['A', 'A'] }
        }]
    };
    const storage = criarStorage({ gabarita_v4: JSON.stringify(sujo) });
    const app = new Gerenciador(storage);
    const a = app.avaliacao;
    assert.deepEqual(a.gabarito, ['A', null]);
    assert.equal(a.areas[0].nome, 'Geral');
    assert.equal(new Set(a.alunos.map(x => x.id)).size, a.alunos.length);
    assert.deepEqual(a.correcoes[1], ['A', null]);
    assert.equal(Object.keys(a.correcoes).length, 1);
    assert.ok(app.avisoCarga);
    assert.ok(storage.dados.gabarita_v4_copia_corrompida);
});

test('falha de gravação é notificada uma vez por sequência de falhas', () => {
    const app = new Gerenciador(criarStorage({}, { falharAoGravar: true }));
    let chamadas = 0;
    app.onErroPersistencia = () => { chamadas++; };
    assert.equal(app.salvarDados(), false);
    assert.equal(app.salvarDados(), false);
    assert.equal(chamadas, 1);
});

test('backup: exporta e importa em outro aparelho, guardando cópia dos dados anteriores', () => {
    const origem = prepararApp(['A', 'B'], ['Ana', 'Bia']);
    corrigir(origem, 'Ana', { 0: 'A', 1: 'B' });
    const backup = JSON.parse(JSON.stringify(origem.exportarBackup()));
    assert.equal(backup.app, 'gabarita');

    const storage = criarStorage();
    const destino = new Gerenciador(storage);
    destino.adicionarAlunos('Aluno antigo');
    const r = destino.importarBackup(JSON.stringify(backup));
    assert.equal(r.avaliacoes, 1);
    assert.deepEqual(destino.avaliacao.alunos.map(a => a.nome), ['Ana', 'Bia']);
    assert.equal(destino.resultadoDoAluno(destino.avaliacao.alunos[0].id).acertos, 2);
    const copia = JSON.parse(storage.dados.gabarita_v4_antes_de_importar);
    assert.equal(copia.materias[0].turmas[0].alunos[0].nome, 'Aluno antigo');
});

test('backup inválido é recusado sem alterar nada', () => {
    const app = prepararApp(['A'], ['Ana']);
    assert.throws(() => app.importarBackup('não é json'), /ilegível/);
    assert.throws(() => app.importarBackup({ app: 'outro', avaliacoes: [] }), /não é um backup/);
    assert.throws(() => app.importarBackup(JSON.stringify({ app: 'gabarita', avaliacoes: [] })), /não é um backup/);
    assert.equal(app.avaliacao.alunos.length, 1);
});

// ---------- hierarquia Matéria → Turma → Avaliação ----------
test('começa com Matéria 1 → Turma 1 → Nova avaliação e informa o contexto', () => {
    const app = new Gerenciador(criarStorage());
    assert.deepEqual(app.contexto, {
        materia: { id: 1, nome: 'Matéria 1' }, turma: { id: 1, nome: 'Turma 1' }, avaliacao: { id: 1, titulo: 'Nova avaliação' }
    });
});

test('matérias, turmas e avaliações: criar, renomear, selecionar e excluir (nunca fica vazio)', () => {
    const app = new Gerenciador(criarStorage());
    app.renomearMateria('Biologia');
    const t1 = app.turmaId;
    const t2 = app.criarTurma('3º B');
    assert.deepEqual(app.turmas.map(t => t.nome), ['Turma 1', '3º B']);
    app.criarMateria('Física');
    assert.deepEqual(app.materias.map(m => m.nome), ['Biologia', 'Física']);
    assert.equal(app.contexto.turma.nome, 'Turma 1'); // matéria nova tem sua própria turma
    app.selecionarMateria(app.materias[0].id);
    assert.equal(app.contexto.materia.nome, 'Biologia');
    app.selecionarTurma(t2);
    assert.equal(app.contexto.turma.nome, '3º B');
    app.excluirTurma(t2);
    assert.equal(app.turmaId, t1);
    app.excluirTurma(t1);
    assert.equal(app.turmas.length, 1); // recria uma turma vazia
    app.excluirMateria(app.materias[0].id);
    app.excluirMateria(app.materias[0].id);
    assert.equal(app.materias.length, 1);
    assert.equal(app.contexto.materia.nome, 'Matéria 1');
    assert.throws(() => app.selecionarTurma(9999), /não encontrada/);
});

test('alunos pertencem à turma: outra turma começa vazia e remover aluno apaga suas correções em todas as avaliações', () => {
    const app = prepararApp(['A'], ['Ana', 'Bia']);
    const turma1 = app.turmaId;
    corrigir(app, 'Ana', { 0: 'A' });
    app.criarAvaliacao('Prova 2');
    app.alterarQuantidadeQuestoes(1); app.marcarGabarito(0, 'A');
    corrigir(app, 'Ana', { 0: 'B' });
    app.criarTurma('Outra');
    assert.equal(app.avaliacao.alunos.length, 0);
    assert.equal(app.avaliacao.titulo, 'Nova avaliação');
    app.selecionarTurma(turma1);
    const ana = app.avaliacao.alunos.find(a => a.nome === 'Ana');
    app.removerAluno(ana.id);
    for (const a of app.avaliacoes) {
        app.selecionarAvaliacao(a.id);
        assert.deepEqual(Object.keys(app.avaliacao.correcoes), []);
    }
    assert.equal(app.avaliacao.alunos.length, 1);
});

test('número de chamada: lido de "nº - nome", sequencial quando falta, único e editável', () => {
    const app = new Gerenciador(criarStorage());
    const r = app.adicionarAlunos('05 - Ana\nBia\n5 - Caio\n12. Duda\nana');
    assert.deepEqual(r, { adicionados: 3, ignorados: 2 }); // Caio (nº 5 repetido) e "ana" (nome repetido)
    assert.deepEqual(app.avaliacao.alunos.map(a => [a.numero, a.nome]), [[1, 'Bia'], [5, 'Ana'], [12, 'Duda']]);
    const bia = app.avaliacao.alunos[0];
    app.editarAluno(bia.id, { nome: 'Bianca', numero: 2 });
    assert.deepEqual(app.avaliacao.alunos.map(a => a.numero), [2, 5, 12]);
    assert.throws(() => app.editarAluno(bia.id, { numero: 5 }), /número/);
    assert.throws(() => app.editarAluno(bia.id, { nome: 'ana' }), /nome/);
    assert.throws(() => app.editarAluno(bia.id, { nome: '  ' }), /vazio/);
    assert.throws(() => app.editarAluno(bia.id, { numero: 0 }), /1 a 999/);
    assert.equal(app.avaliacao.alunos[0].nome, 'Bianca');
});

test('buscarAluno: por número de chamada exato ou parte do nome (sem acento/maiúscula)', () => {
    const app = new Gerenciador(criarStorage());
    app.adicionarAlunos('1 - José Álvares\n2 - Maria José\n12 - Ana');
    assert.deepEqual(app.buscarAluno('12').map(a => a.nome), ['Ana']);
    assert.deepEqual(app.buscarAluno('jose').map(a => a.nome), ['José Álvares', 'Maria José']);
    assert.deepEqual(app.buscarAluno('  '), []);
    assert.deepEqual(app.buscarAluno('99'), []);
});

test('definirGabarito aceita só A–E em todas as questões', () => {
    const app = new Gerenciador(criarStorage());
    app.alterarQuantidadeQuestoes(3);
    assert.throws(() => app.definirGabarito(['A', null, 'C']), /todas as questões/);
    assert.throws(() => app.definirGabarito(['A', 'B']), /todas as questões/);
    assert.throws(() => app.definirGabarito(['A', '!', 'C']), /todas as questões/);
    app.definirGabarito(['A', 'B', 'C']);
    assert.equal(app.gabaritoEstaCompleto, true);
});

test('migra v4: cada avaliação antiga vira uma turma da matéria "Geral", sem perder alunos nem correções', () => {
    const v4 = {
        versao: 4, atualId: 2,
        avaliacoes: [
            { id: 1, titulo: 'Bim 1', totalQuestoes: 2, gabarito: ['A', 'B'], areas: [{ id: 1, nome: 'Geral', inicio: 1, fim: 2 }],
              alunos: [{ id: 1, nome: '01 - Ana' }, { id: 2, nome: 'Bia' }], correcoes: { 1: ['A', 'B'] } },
            { id: 2, titulo: 'Bim 2', totalQuestoes: 1, gabarito: ['C'], alunos: [{ id: 1, nome: 'Caio' }], correcoes: { 1: ['C'] } }
        ]
    };
    const storage = criarStorage({ gabarita_v4: JSON.stringify(v4) });
    const app = new Gerenciador(storage);
    assert.match(app.avisoCarga, /migrados/);
    assert.deepEqual(app.materias.map(m => m.nome), ['Geral']);
    assert.deepEqual(app.turmas.map(t => t.nome), ['Bim 1', 'Bim 2']);
    assert.equal(app.contexto.turma.nome, 'Bim 2'); // seleção anterior preservada
    assert.equal(app.resultadoDoAluno(app.avaliacao.alunos[0].id).acertos, 1);
    app.selecionarTurma(app.turmas[0].id);
    assert.deepEqual(app.avaliacao.alunos.map(a => [a.numero, a.nome]), [[1, 'Ana'], [2, 'Bia']]);
    assert.equal(app.resultadoDoAluno(app.avaliacao.alunos[0].id).acertos, 2);
    assert.equal(storage.dados.gabarita_v4, JSON.stringify(v4), 'dados antigos intactos');
    assert.ok(storage.dados.gabarita_v5);
});

test('v5 persiste a seleção e recarrega; backup v4 também pode ser importado', () => {
    const storage = criarStorage();
    const app = prepararApp(['A', 'B'], ['Ana'], storage);
    app.renomearMateria('Química');
    app.criarTurma('2º C');
    const outra = new Gerenciador(storage);
    assert.equal(outra.contexto.materia.nome, 'Química');
    assert.equal(outra.contexto.turma.nome, '2º C');
    const r = outra.importarBackup({ app: 'gabarita', versao: 4, atualId: 1, avaliacoes: [{ id: 1, titulo: 'Velha', totalQuestoes: 1, gabarito: ['A'], alunos: [{ id: 1, nome: 'Zé' }], correcoes: {} }] });
    assert.deepEqual([r.materias, r.avaliacoes], [1, 1]);
    assert.equal(outra.contexto.turma.nome, 'Velha');
    assert.equal(outra.avaliacao.alunos[0].nome, 'Zé');
});
