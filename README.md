# Pequi Express + GO ID

Arquivos soltos (sem pastas) para GitHub / GitHub Pages.

## Arquivos

| Arquivo | Função |
|---------|--------|
| `index.html` | Redireciona para o Pequi |
| `pequi.html` | Portal de boletim |
| `pequi-app.js` / `pequi-data.js` / `pequi-styles.css` | Lógica e estilo do Pequi |
| `goid.html` | Login GO ID (CPF + senha) |
| `goid-app.js` / `goid-styles.css` | Lógica e estilo do GO ID |
| `brasao-goias.svg` | Brasão de Goiás |

## Fluxo

1. Abra `pequi.html`
2. Clique em **Entrar com GO ID** → `goid.html`
3. Após login, volta para `pequi.html` com sessão

## Firebase

- GO ID: `https://goid-57028-default-rtdb.firebaseio.com`
- SIGEP: `https://siap-f9cbb-default-rtdb.firebaseio.com`
