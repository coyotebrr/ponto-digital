n# Ponto Digital

Aplicação web de registro de jornada com API Node.js e PostgreSQL. O navegador não acessa o banco diretamente: cadastro, login e registros passam pela API.

## Requisitos

- Node.js 18 ou superior
- PostgreSQL acessível pela máquina que executa a API

## Configurar o banco

Crie o banco e um usuário próprio para a aplicação no PostgreSQL. Em seguida, execute o conteúdo de `schema.sql` nesse banco (por exemplo, pelo Query Tool do pgAdmin).

Se o banco já foi criado usando o esquema anterior, confirme que ele possui as tabelas `users` e `time_records` com as colunas definidas em `schema.sql`. Os valores válidos para `time_records.record_type` são `entrada` e `saida`.

## Executar localmente

1. Copie `.env.example` para `.env` e informe a URL do PostgreSQL e uma chave aleatória forte em `JWT_SECRET`.
2. Instale as dependências: `npm install`.
3. Inicie o servidor: `npm start`.
4. Abra `http://localhost:3000` no navegador. Não abra o `index.html` diretamente como arquivo.
5. Verifique a API em `http://localhost:3000/api/health`.

Gere uma chave para `JWT_SECRET` com:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Não publique o arquivo `.env`, a senha do PostgreSQL ou o segredo JWT. O login exige senhas com pelo menos 8 caracteres; o servidor armazena um hash scrypt, nunca a senha em texto puro.

## Acesso pela internet

Mantenha o PostgreSQL acessível somente localmente ou por uma rede privada. Publique a API por HTTPS atrás de um proxy reverso, VPN ou túnel seguro; não exponha a porta do PostgreSQL diretamente.

Se o site e a API ficarem em origens diferentes:

- Informe as origens exatas do site em `FRONTEND_ORIGINS`, separadas por vírgula.
- Configure `API_ORIGIN` com a origem pública da API (por exemplo, `https://api.exemplo.com`).
- Em `config.js`, defina `window.PONTO_API_URL` com a URL pública da API.
- Use HTTPS para o site e para a API.

Reinicie o servidor após alterar o `.env`. A máquina do banco/API precisa permanecer ligada e conectada para receber registros.

Por padrão, o servidor escuta apenas em `127.0.0.1`. Se o ambiente de hospedagem exigir uma interface de rede, configure `HOST=0.0.0.0` e mantenha a API atrás de um proxy HTTPS ou túnel seguro.
