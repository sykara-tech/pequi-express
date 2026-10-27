# Pequi Express + GO ID — versão final (segura)

Tudo em uma única pasta para publicar no GitHub Pages (ou qualquer host estático).

## Arquivos

| Arquivo | Função |
|---------|--------|
| `index.html` | Redireciona para o Pequi |
| `pequi.html` + `pequi-*.js/css` | Portal de boletim escolar |
| `goid.html` + `goid-*.js/css` | Login, cadastro e recuperação de senha |
| `brasao-goias.svg` | Brasão de Goiás |
| `email-template/` | HTML do e-mail de recuperação (só para configurar no EmailJS) |

## Segurança de sessão

- **Sair no GO ID**: limpa a sessão local, o token SSO e grava uma flag de logout. A sessão **não volta sozinha** até um novo login.
- **Sair no Pequi**: encerra a sessão do portal e descarta tokens SSO residuais.
- Sessões com expiração e idle timeout no Pequi Express.

## Recuperação de senha

1. CPF → envio do código por e-mail  
2. Código → validação  
3. Nova senha  

EmailJS já configurado no código. Use o HTML de `email-template/template-recuperacao.html` no painel EmailJS (To Email = `{{to_email}}`).

## LGPD

Links **Termos de Uso** e **Política de Privacidade (LGPD)** no login e no cadastro.
