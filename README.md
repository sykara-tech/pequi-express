# Pequi Express + ClarIA — versão final

Portal de documentos escolares do Estado de Goiás.

## Documentos oficiais

1. **Boletim Escolar** — modelo institucional SEDUC (notas N/F por bimestre, MA, média final, faltas)
2. **Comprovante de Matrícula** — vínculo escolar formal
3. **Frequência Anual** — percentual, total de faltas e identificação do aluno

Todos com **QR Code** + código único `PE-XXXXXX` e validação pública.

## Validação (sem login)

Na página inicial:
- Digite o código e clique em **Validar**
- Ou clique em **QR** para abrir a câmera e ler o código

## Uso

```bash
cd PequiExpress
python -m http.server 8080
```

http://localhost:8080

Login via **GO ID**. Assistente **ClarIA** (bola verde).

---
Pequi Express · Governo de Goiás · Sykara
