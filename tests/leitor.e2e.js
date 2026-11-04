// Regressão do leitor nas fotos reais. Requer Playwright + Chromium:  node tests/leitor.e2e.js
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const esperado = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/esperado.json'), 'utf8'));
let falhas = 0;
const ok = (c, m) => { console.log((c ? 'OK    ' : 'FALHA ') + m); if (!c) falhas++; };

(async () => {
    const b = await chromium.launch();
    const p = await b.newPage();
    await p.goto('about:blank');
    await p.addScriptTag({ path: path.join(__dirname, '../leitor.js') });
    for (const [arq, esp] of Object.entries(esperado)) {
        if (arq.startsWith('_')) continue;
        const b64 = fs.readFileSync(path.join(__dirname, 'fixtures', arq)).toString('base64');
        const r = await p.evaluate(async (b64) => {
            const img = new Image(); img.src = 'data:image/jpeg;base64,' + b64; await img.decode();
            const c = document.createElement('canvas');
            const k = 1600 / Math.max(img.width, img.height);
            c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
            const x = c.getContext('2d'); x.drawImage(img, 0, 0, c.width, c.height);
            const d = x.getImageData(0, 0, c.width, c.height);
            const res = GabaritaLeitor.lerCartao(d);
            if (!res.ok) return { ok: false, motivo: res.motivo };
            // mesma leitura informando os cantos da tabela esquerda à mão (embaralhados)
            const q = res.quads[0].map(p => [p[0], p[1]]);
            const man = GabaritaLeitor.lerCartao(d, GabaritaLeitor.MODELO_GOIAS_40, { cantos: [q[2], q[0], q[3], q[1]] });
            const txt = (a) => a.map(v => v === null ? '.' : v === '!' ? '*' : v).join('');
            return { ok: true, txt: txt(res.respostas), rev: res.revisar.map((v, i) => v ? i + 1 : 0).filter(Boolean), man: man.ok ? txt(man.respostas) : null };
        }, b64);
        ok(r.ok && r.txt === esp.leitura, `${arq}: leitura automática igual ao esperado${r.ok ? '' : ' (' + r.motivo + ')'}`);
        ok(r.ok && JSON.stringify(r.rev) === JSON.stringify(esp.revisar), `${arq}: questões a revisar = [${esp.revisar}]`);
        ok(r.ok && r.man === esp.leitura, `${arq}: leitura com cantos informados à mão é idêntica`);
    }
    // imagem sem cartão não pode "ler" nada
    const vazio = await p.evaluate(() => {
        const d = new ImageData(900, 1600); d.data.fill(255);
        return GabaritaLeitor.lerCartao(d);
    });
    ok(vazio.ok === false, 'imagem em branco é recusada, sem inventar respostas');
    await b.close();
    console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo');
    process.exit(falhas ? 1 : 0);
})();
