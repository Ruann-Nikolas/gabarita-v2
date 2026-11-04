# Gabarita v2

Abrir `index.html` no navegador (sem build, sem servidor). Dados ficam no aparelho (localStorage).

Arquivos: `dominio.js` (regras, dados, CSV, backup) · `leitor.js` (leitura do cartão por foto, só modelo Goiás 40 questões) · `app.js` (interface) · `style.css`.

Testes (Node + Playwright): `node --test tests/dominio.test.js`, `node tests/leitor.e2e.js`, `SCRATCH=<pasta> node tests/app.e2e.js`.

Limitações: leitura por foto só para o cartão de 40 questões; avaliações com outra quantidade usam correção manual. Testado com 5 fotos.
