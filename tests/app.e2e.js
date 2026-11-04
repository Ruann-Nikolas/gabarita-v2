// Teste ponta a ponta no Chromium (celular 360px):  node tests/app.e2e.js
// Requer Playwright + Chromium. Usa as fotos de tests/fixtures.
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const URL = 'file://' + path.resolve(__dirname, '../index.html');
const FOTO = (n) => path.join(__dirname, 'fixtures', `foto${n}.jpg`);
let falhas = 0;
const ok = (c, m) => { console.log((c ? 'OK    ' : 'FALHA ') + m); if (!c) falhas++; };

// Respostas da foto 2 (conferidas a olho, 40 questões)
const FOTO2 = 'BCEEABBDCDDDCBEACDDAAABCCEDCAABDCADCEEAA'.split('');
const prox = (l) => 'ABCDE'['ABCDE'.indexOf(l) + 1] || 'A';
// Gabarito = foto 2, com 6 erros em Física (Q14–19) e 5 em Química (Q26–30)
const GAB = FOTO2.map((l, i) => ((i >= 13 && i <= 18) || (i >= 25 && i <= 29) ? prox(l) : l));

(async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, acceptDownloads: true });
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', e => erros.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') erros.push(m.text()); });
    const dialogos = [];
    let aceitar = true, promptResp = '';
    page.on('dialog', async d => { dialogos.push(d.type() + ': ' + d.message()); if (aceitar) await d.accept(d.type() === 'prompt' ? promptResp : undefined); else await d.dismiss(); });
    const semOverflow = async (rotulo) => ok(!(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)), `sem rolagem horizontal (${rotulo})`);
    const toast = async () => (await page.textContent('#toast')) || '';

    await page.goto(URL);

    // ---------- Configurar ----------
    const cab = async () => (await page.$$eval('#titulo-exame-header .ctx-item', is => is.map(i => i.innerText.replace(/\s+/g, ' ').trim().toLowerCase())));
    ok(JSON.stringify(await cab()) === JSON.stringify(['matéria matéria 1', 'turma turma 1', 'avaliação nova avaliação']), 'abre com Matéria 1 › Turma 1 › Nova avaliação, todos no header');
    ok((await page.locator('#select-turma').evaluate(s => s.previousElementSibling.textContent)) === 'Nome da Turma', 'campo "Nome da Turma" na configuração');
    promptResp = 'Biologia'; await page.click('#btn-renomear-materia');
    promptResp = '3º B'; await page.click('#btn-renomear-turma');
    await page.click('#aba-corrigir');
    ok((await toast()).includes('Preencha'), 'aba Corrigir bloqueada sem gabarito (aviso não bloqueante)');

    await page.fill('#input-titulo-prova', 'Bloco 2º bimestre');
    await page.press('#input-titulo-prova', 'Tab');
    ok(JSON.stringify(await cab()) === JSON.stringify(['matéria biologia', 'turma 3º b', 'avaliação bloco 2º bimestre']), 'header mostra matéria, turma e avaliação selecionadas');
    await page.click('#btn-modelo-goias');
    ok((await page.inputValue('#input-qtd-questoes')) === '40', 'modelo ajusta para 40 questões');
    const areasUI = await page.$$eval('#lista-areas .linha-area', ls => ls.map(l => [l.querySelector('input[type=text]').value, ...[...l.querySelectorAll('input[type=number]')].map(i => i.value)]));
    ok(JSON.stringify(areasUI) === JSON.stringify([['Biologia', '1', '13'], ['Física', '14', '25'], ['Química', '26', '40']]), 'áreas Biologia 1–13, Física 14–25, Química 26–40');

    // área inválida é recusada com mensagem
    await page.fill('#lista-areas .linha-area:nth-child(2) input[type=number]:nth-of-type(1)', '10');
    await page.click('#btn-salvar-areas');
    ok(await page.locator('#erro-areas').isVisible() && (await page.textContent('#erro-areas')).includes('sobrepõe'), 'sobreposição de áreas é recusada com mensagem');
    await page.fill('#lista-areas .linha-area:nth-child(2) input[type=number]:nth-of-type(1)', '14');
    await page.click('#btn-salvar-areas');
    ok(!(await page.locator('#erro-areas').isVisible()) && (await toast()).includes('Áreas salvas'), 'áreas corretas são salvas');

    for (let i = 0; i < 40; i++) {
        await page.locator('#grade-mestre .linha-questao').nth(i).locator('.bolinha-opcao', { hasText: GAB[i] }).click();
    }
    ok((await page.textContent('#badge-status-mestre')).includes('pronto'), 'gabarito completo: selo "pronto"');
    await semOverflow('Configurar');

    // ---------- Turma: lista de alunos ----------
    await page.click('#btn-ir-turma');
    ok(await page.locator('#secao-turma').isVisible(), 'ação "Turma" abre o gerenciamento de alunos');
    await page.fill('#textarea-alunos', "01 - Ana D'Ávila\n02 - Bruno\n03 - Carla\n02 - bruno");
    await page.click('#btn-add-alunos');
    ok((await page.textContent('#contador-alunos')) === '3' && (await toast()).includes('1 repetido ignorado'), '3 alunos adicionados; repetido ignorado');
    await semOverflow('Turma');
    // editar aluno: troca nome e número; número repetido é recusado
    await page.locator('#lista-alunos-salvos .item-nota').nth(1).getByRole('button', { name: /Editar/ }).click();
    await page.fill('.item-nota.editando .edit-numero', '1');
    await page.click('.item-nota.editando >> text=Salvar');
    ok((await toast()).includes('número de chamada'), 'editar com número repetido é recusado');
    await page.fill('.item-nota.editando .edit-numero', '2');
    await page.fill('.item-nota.editando .edit-nome', 'Bruno Lima');
    await page.click('.item-nota.editando >> text=Salvar');
    ok((await page.locator('#lista-alunos-salvos .item-nota').nth(1).innerText()).includes('02 – Bruno Lima'), 'aluno editado (nome) aparece na lista');

    // ---------- Corrigir: foto 2 (aluno 1) ----------
    await page.click('#btn-turma-corrigir');
    ok((await page.inputValue('#select-aluno')) !== '' && (await page.$eval('#select-aluno', s => s.selectedOptions[0].textContent)).includes('Ana'), 'primeiro aluno pendente já vem selecionado');
    // identificar o aluno por nº de chamada ou nome ANTES de fotografar
    await page.fill('#input-busca-aluno', '3');
    await page.click('#lista-busca-aluno .item-busca');
    ok((await page.textContent('#aluno-selecionado-info')).includes('03 – Carla'), 'busca por nº de chamada seleciona a aluna 03');
    await page.fill('#input-busca-aluno', 'ana');
    await page.press('#input-busca-aluno', 'Enter');
    ok((await page.textContent('#aluno-selecionado-info')).includes("01 – Ana D'Ávila") && (await page.inputValue('#input-busca-aluno')) === '', 'busca por nome (Enter) seleciona o aluno 01');
    await page.fill('#input-busca-aluno', '99');
    ok((await page.textContent('#lista-busca-aluno')).includes('Ninguém'), 'busca sem resultado avisa');
    await page.fill('#input-busca-aluno', '');
    await page.setInputFiles('#input-foto', FOTO(2));
    await page.waitForSelector('#painel-conferencia:not(.oculto)');
    ok((await page.textContent('#aviso-leitura')).includes('Cartão lido'), 'foto 2 lida');
    ok((await page.textContent('#res-acertos-valor')).trim() === '29 / 40', 'foto 2: 29 / 40 acertos');
    const areasRes = await page.$$eval('#lista-res-areas li', ls => ls.map(l => l.innerText.replace(/\s+/g, ' ').trim()));
    ok(areasRes.length === 3 && areasRes[0].startsWith('Biologia 13/13') && areasRes[1].startsWith('Física 6/12') && areasRes[2].startsWith('Química 10/15'), `resultado por área: ${areasRes.join(' | ')}`);
    ok(await page.locator('#contador-revisar').isHidden(), 'nenhuma questão em dúvida na foto 2');
    ok(await page.locator('#detalhe-leitura').isVisible(), 'há conferência visual da leitura');
    await semOverflow('Corrigir com painel');
    await page.screenshot({ path: path.join(process.env.SCRATCH || '/tmp', 'painel_mobile.png') });
    await page.click('#btn-confirmar-nota');
    ok((await toast()).includes('29/40') && (await toast()).includes('Próximo: 02 – Bruno Lima'), 'salvou e avançou para o próximo aluno');
    ok((await page.$eval('#select-aluno', s => s.selectedOptions[0].textContent)).includes('Bruno'), 'select já aponta o próximo aluno');
    ok(await page.locator('#painel-conferencia').isHidden(), 'painel fecha após salvar');

    // ---------- Corrigir: foto 5 (aluno 2): questões a revisar + cantos manuais ----------
    await page.setInputFiles('#input-foto', FOTO(5));
    await page.waitForSelector('#painel-conferencia:not(.oculto)');
    ok((await page.textContent('#contador-revisar')).startsWith('1 questão'), 'foto 5: 1 questão para conferir (Q22)');
    ok((await page.locator('#grade-aluno .linha-questao.revisar').count()) === 1, 'linha destacada na grade');
    const brancos = await page.textContent('#pill-brancos');
    ok(brancos.startsWith('1 em branco'), 'Q22 chega como em branco (mancha fora da bolha)');
    // o professor confere a foto e marca E na Q22
    await page.locator('#grade-aluno .linha-questao').nth(21).locator('.bolinha-opcao', { hasText: /^E$/ }).click();
    ok((await page.locator('#grade-aluno .linha-questao.revisar').count()) === 0, 'conferida a Q22, nada mais em destaque');
    ok((await page.textContent('#pill-brancos')).startsWith('0 em branco'), 'agora 0 em branco');

    // marcar cantos manualmente (leitura deve ser idêntica à automática); antes, pega os cantos reais da foto 5
    const quad = await (async () => {
        const p2 = await ctx.newPage(); await p2.goto('about:blank'); await p2.addScriptTag({ path: path.join(__dirname, '../leitor.js') });
        const b64 = fs.readFileSync(FOTO(5)).toString('base64');
        const q = await p2.evaluate(async (b64) => {
            const img = new Image(); img.src = 'data:image/jpeg;base64,' + b64; await img.decode();
            const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
            const x = c.getContext('2d'); x.drawImage(img, 0, 0);
            return GabaritaLeitor.lerCartao(x.getImageData(0, 0, c.width, c.height)).quads[0];
        }, b64);
        await p2.close(); return q;
    })();
    aceitar = true;
    await page.evaluate(() => { document.getElementById('aviso-leitura').textContent = ''; });
    await page.click('#btn-cantos-manual');
    ok(await page.locator('#painel-cantos').isVisible(), 'painel de cantos abre');
    const caixa = await page.locator('#canvas-cantos').boundingBox();
    const wImg = await page.$eval('#canvas-cantos', c => c.width);
    for (const p of [quad[2], quad[0], quad[3], quad[1]]) {
        await page.locator('#canvas-cantos').click({ position: { x: p[0] * caixa.width / wImg, y: p[1] * caixa.width / wImg }, force: true });
    }
    await page.waitForFunction(() => document.getElementById('painel-cantos').classList.contains('oculto'));
    await page.waitForFunction(() => /Cartão lido/.test(document.getElementById('aviso-leitura').textContent));
    ok((await page.textContent('#contador-revisar')).startsWith('1 questão') && !(await page.textContent('#aviso-leitura')).includes('Atenção'), 'leitura com cantos marcados à mão reproduz a automática (1 em destaque, sem alarme)');
    await page.locator('#grade-aluno .linha-questao').nth(21).locator('.bolinha-opcao', { hasText: /^E$/ }).click();
    await page.click('#btn-confirmar-nota');

    // ---------- foto 1 (aluno 3): duplas marcações ----------
    await page.setInputFiles('#input-foto', FOTO(1));
    await page.waitForSelector('#painel-conferencia:not(.oculto)');
    ok((await page.textContent('#pill-rasuras')).startsWith('2 rasuras'), 'foto 1: Q26 e Q36 chegam como dupla marcação (!)');
    ok((await page.textContent('#contador-revisar')).startsWith('2 questões'), 'foto 1: 2 questões em destaque (Q26, Q36)');
    const antes = dialogos.length;
    await page.click('#btn-confirmar-nota'); // 2 pendentes: deve perguntar
    ok(dialogos.slice(antes).some(d => d.includes('ainda não foram conferidas')), 'salvar com questões em destaque pede confirmação');
    ok((await toast()).includes('Todos os alunos da lista foram corrigidos'), 'aviso de que todos foram corrigidos');

    // foto que não é um cartão
    await page.click('#aba-turma');
    await page.fill('#textarea-alunos', 'Daniel');
    await page.click('#btn-add-alunos');
    await page.click('#aba-corrigir');
    const branca = path.join(process.env.SCRATCH || '/tmp', 'branca.png');
    const png = await (await ctx.newPage()).evaluate(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 900; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 600, 900); return c.toDataURL('image/png').split(',')[1]; });
    fs.writeFileSync(branca, Buffer.from(png, 'base64'));
    await page.setInputFiles('#input-foto', branca);
    await page.waitForFunction(() => /Não consegui localizar/.test(document.getElementById('aviso-leitura').textContent));
    ok(await page.locator('#painel-conferencia').isHidden() && await page.locator('#btn-cantos-manual').isVisible(), 'foto sem cartão: erro claro, nada é inventado, oferece marcar cantos');

    // ---------- Turma: estatísticas e CSV ----------
    await page.click('#aba-resultados');
    ok((await page.textContent('#metrica-corrigidos')) === '3/4', 'métrica: 3 de 4 corrigidos');
    const stats = await page.$$eval('#lista-stats-areas li', ls => ls.map(l => l.innerText.replace(/\s+/g, ' ').trim()));
    ok(stats.length === 3 && stats[0].startsWith('Biologia'), `desempenho por área: ${stats.join(' | ')}`);
    const itens = await page.$$eval('#lista-resultados .item-nota', e => e.map(x => x.innerText.replace(/\n/g, ' / ')));
    ok(itens[0].includes("Ana D'Ávila") && itens[0].includes('29/40') && itens[0].includes('Biologia 13/13 · Física 6/12 · Química 10/15'), 'lista mostra nota total e por área do aluno 1');
    ok(itens[3].includes('Ainda não corrigido'), 'aluno sem correção aparece como pendente');
    await semOverflow('Turma com dados');

    const [dlCsv] = await Promise.all([page.waitForEvent('download'), page.click('#btn-exportar-csv')]);
    const csv = fs.readFileSync(await dlCsv.path(), 'utf8').split('\r\n');
    console.log('      CSV:', dlCsv.suggestedFilename());
    ok(csv[0].includes('Materia;Turma;Avaliacao;Numero;Aluno') && csv[1].startsWith('Biologia;3º B;Bloco 2º bimestre;1;') && csv[0].includes('Biologia - Acertos (de 13);Biologia - %;Física - Acertos (de 12)') && csv.length === 5, 'CSV: colunas por área e 3 linhas de alunos');
    ok(csv[1].includes(";29;") && csv[1].includes(';13;100;6;50;10;67;'), 'CSV: linha do aluno 1 com 29 acertos e totais por área');

    // ---------- Backup e restauração ----------
    const [dlBk] = await Promise.all([page.waitForEvent('download'), page.click('#btn-exportar-backup')]);
    const arquivoBackup = await dlBk.path();
    const backup = JSON.parse(fs.readFileSync(arquivoBackup, 'utf8'));
    const turmaBk = backup.materias[0].turmas[0];
    ok(backup.app === 'gabarita' && backup.versao === 5 && turmaBk.alunos.length === 4 && Object.keys(turmaBk.avaliacoes[0].correcoes).length === 3, 'backup v5 contém matéria, turma, 4 alunos e 3 correções');
    await page.click('#btn-limpar-dados');
    ok((await page.textContent('#contador-alunos')) === '0', 'apagar tudo zera os dados');
    await page.setInputFiles('#input-importar-backup', arquivoBackup);
    await page.waitForFunction(() => /Backup restaurado/.test(document.getElementById('toast').textContent));
    await page.click('#aba-resultados');
    ok((await page.textContent('#contador-alunos')) === '4' && (await page.textContent('#metrica-corrigidos')) === '3/4', 'restaurar backup traz tudo de volta');
    await page.setInputFiles('#input-importar-backup', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"nao":"e backup"}') });
    await page.waitForFunction(() => /não é um backup/.test(document.getElementById('toast').textContent));
    ok(true, 'arquivo que não é backup é recusado com mensagem');

    // ---------- Persistência ----------
    await page.reload();
    ok((await page.textContent('#contador-alunos')) === '4' && JSON.stringify(await cab()) === JSON.stringify(['matéria biologia', 'turma 3º b', 'avaliação bloco 2º bimestre']), 'dados e seleção sobrevivem ao recarregar');

    // ---------- Várias avaliações ----------
    await page.click('#aba-mestre');
    await page.click('#btn-nova-avaliacao');
    ok((await page.$$eval('#select-avaliacao option', o => o.length)) === 2, 'nova avaliação criada (2 na lista)');
    ok((await page.textContent('#contador-alunos')) === '4' && (await page.textContent('#badge-status-mestre')).includes('pendente'), 'nova avaliação da mesma turma: alunos compartilhados, gabarito pendente');
    await page.selectOption('#select-avaliacao', { label: 'Bloco 2º bimestre' });
    ok((await page.textContent('#badge-status-mestre')).includes('pronto'), 'voltar à primeira avaliação mantém o gabarito');
    // avaliação de 20 questões: foto desativada, marcação manual disponível
    await page.click('#btn-nova-avaliacao');
    await page.fill('#input-qtd-questoes', '5');
    await page.click('#btn-aplicar-qtd');
    for (let i = 0; i < 5; i++) await page.locator('#grade-mestre .linha-questao').nth(i).locator('.bolinha-opcao').first().click();
    await page.click('#aba-turma');
    await page.fill('#textarea-alunos', 'Eva');
    await page.click('#btn-add-alunos');
    await page.click('#aba-corrigir');
    ok(await page.locator('#input-foto').isDisabled() && (await page.textContent('#dica-foto')).includes('40 questões'), 'avaliação com 5 questões: leitura por foto desativada, com explicação');
    await page.click('#btn-manual');
    await page.locator('#grade-aluno .linha-questao').nth(0).locator('.bolinha-opcao', { hasText: /^A$/ }).click();
    await page.click('#btn-confirmar-nota');
    ok((await toast()).includes('1/5'), 'correção manual funciona na avaliação de 5 questões');

    // ---------- Hierarquia: outra matéria tem turmas e alunos próprios ----------
    await page.click('#aba-mestre');
    // gabarito pela câmera indisponível em avaliação de 5 questões
    await page.click('#btn-modo-camera');
    ok(await page.locator('#input-foto-gabarito').isDisabled() && (await page.textContent('#dica-gab-camera')).includes('40 questões'), 'gabarito pela câmera: desativado fora do modelo de 40 questões, com explicação');
    await page.click('#btn-modo-manual');
    promptResp = 'Física'; await page.click('#btn-nova-materia');
    ok(JSON.stringify(await cab()) === JSON.stringify(['matéria física', 'turma turma 1', 'avaliação nova avaliação']), 'nova matéria nasce com Turma 1 e uma avaliação');
    await page.click('#aba-turma');
    ok((await page.textContent('#contador-alunos')) === '0', 'a nova matéria não herda alunos');
    await page.click('#aba-mestre');
    await page.selectOption('#select-materia', { label: 'Biologia' });
    await page.click('#aba-turma');
    ok((await page.textContent('#contador-alunos')) === '5', 'voltar a Biologia › 3º B traz os 5 alunos');
    await page.click('#aba-mestre');
    await page.selectOption('#select-avaliacao', { label: 'Bloco 2º bimestre' });
    promptResp = '3º C'; await page.click('#btn-nova-turma');
    await page.click('#aba-turma');
    ok((await page.textContent('#contador-alunos')) === '0' && (await cab())[1] === 'turma 3º c', 'nova turma começa sem alunos e sem avaliações da outra turma');
    await page.click('#aba-mestre');
    ok((await page.$$eval('#select-avaliacao option', o => o.map(x => x.textContent))).join() === 'Nova avaliação', 'avaliações pertencem à turma');

    // ---------- Gabarito pela câmera ----------
    const gabLido = () => page.$$eval('#grade-mestre .linha-questao', ls => ls.map(l => (l.querySelector('.bolinha-opcao.selecionada') || {}).textContent || '.').join(''));
    await page.fill('#input-qtd-questoes', '40');
    await page.click('#btn-aplicar-qtd');
    await page.click('#btn-modo-camera');
    ok(await page.locator('#input-foto-gabarito').isEnabled(), 'gabarito pela câmera disponível com 40 questões');
    await page.setInputFiles('#input-foto-gabarito', FOTO(5));
    await page.waitForSelector('#painel-gab-camera:not(.oculto)');
    ok(await page.locator('#btn-confirmar-gabarito').isDisabled() && (await page.textContent('#resumo-gab-camera')).includes('1 em branco'), 'foto 5 como mestre: Q22 em branco bloqueia a confirmação e é sinalizada');
    ok((await page.locator('#grade-gab-camera .linha-questao.revisar').count()) === 1, 'questão em branco aparece em destaque');
    ok(await page.locator('#btn-confirmar-gabarito').isDisabled(), 'confirmar fica bloqueado até definir todas as questões');
    await page.locator('#grade-gab-camera .linha-questao').nth(21).locator('.bolinha-opcao', { hasText: /^E$/ }).click();
    ok(await page.locator('#btn-confirmar-gabarito').isEnabled() && (await page.locator('#grade-gab-camera .linha-questao.revisar').count()) === 0, 'ajuste manual libera a confirmação');
    const antesGab = dialogos.length;
    await page.click('#btn-confirmar-gabarito');
    ok(dialogos.slice(antesGab).some(d => d.startsWith('confirm') && d.includes('Salvar este gabarito')), 'salvar o gabarito pede confirmação');
    ok((await page.textContent('#badge-status-mestre')).includes('pronto'), 'gabarito lido pela câmera salvo (selo "pronto")');
    ok((await gabLido()) === 'AEACBDEBBCADAEBDBCBCDEABDEBADEBCBADDEDCB', 'gabarito salvo = leitura da foto 5 com a Q22 ajustada para E');

    // recusa salvar: cancelar a confirmação não altera nada
    await page.click('#btn-modo-camera');
    await page.setInputFiles('#input-foto-gabarito', FOTO(2));
    await page.waitForSelector('#painel-gab-camera:not(.oculto)');
    ok((await page.locator('#grade-gab-camera .linha-questao .bolinha-opcao.selecionada').count()) === 40, 'foto 2 como mestre: 40 respostas lidas');
    aceitar = false;
    await page.click('#btn-confirmar-gabarito');
    aceitar = true;
    await page.click('#btn-modo-manual');
    ok((await gabLido()) === 'AEACBDEBBCADAEBDBCBCDEABDEBADEBCBADDEDCB', 'confirmação recusada: gabarito anterior intacto');
    await page.click('#btn-modo-camera');
    await page.click('#btn-confirmar-gabarito');
    await page.click('#btn-modo-manual');
    ok((await gabLido()) === FOTO2.join(''), 'confirmação aceita: gabarito = leitura da foto 2');
    await semOverflow('Configurar com gabarito pela câmera');

    // ---------- Desktop ----------
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.click('#aba-mestre');
    await page.selectOption('#select-materia', { label: 'Biologia' });
    await semOverflow('desktop');
    await page.screenshot({ path: path.join(process.env.SCRATCH || '/tmp', 'config_desktop.png') });

    ok(erros.length === 0, 'sem erros de console/JS' + (erros.length ? ': ' + erros.join(' | ') : ''));
    await browser.close();
    console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo');
    process.exit(falhas ? 1 : 0);
})();
