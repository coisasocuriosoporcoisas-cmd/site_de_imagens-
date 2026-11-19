# Galeria Lume

Galeria independente feita com HTML, CSS e JavaScript, servida por Cloudflare Workers. O Worker protege o painel administrativo e fornece as APIs; D1 guarda metadados e autenticação, e R2 guarda as imagens.

## Funcionalidades

- Galeria responsiva com pesquisa, filtros por tags, paginação e tema claro/escuro.
- Página de imagem com descrição, tags, imagens semelhantes e download.
- Painel administrativo com upload de imagens e URLs HTTPS, edição, exclusão e gestão de tags.
- Login administrativo com sessão assinada, bloqueio progressivo de tentativas e TOTP opcional.
- Imagens protegidas por um bucket R2 privado; o Worker serve as imagens públicas.

## Requisitos

- Node.js 22.12 ou superior.
- Conta Cloudflare com Workers, D1 e R2 habilitados.
- Wrangler autenticado: `npx wrangler login`.

## Recursos Cloudflare

O `wrangler.jsonc` usa os nomes `galeria-lume-db` para D1 e `galeria-lume-images` para R2. Não há IDs de conta ou segredos no repositório.

Crie o banco e o bucket:

```powershell
npx wrangler d1 create galeria-lume-db
npx wrangler r2 bucket create galeria-lume-images
```

Copie o `database_id` mostrado pelo comando D1 para `d1_databases[0].database_id` em `wrangler.jsonc`. O ID de exemplo no arquivo é apenas para desenvolvimento local e precisa ser substituído antes do uso remoto.

## Importar os dados locais existentes

Os dados atuais continuam em `data/gallery.json` e `data/images/` até serem importados. O importador transfere metadados, tags, utilizadores administrativos, tentativas de login, TOTP e auditoria para D1, e os 194 ficheiros locais de imagem para R2, sem apagar as cópias locais. URLs externas permanecem como URLs.

```powershell
npm ci
npm run db:remote
npm run migrate:data -- --dry-run
```

O dry-run verifica a estrutura e a presença dos ficheiros sem enviar dados. Para importar para a Cloudflare:

1. Substitua o ID D1 de exemplo e crie/aplique os recursos.
2. Configure `ADMIN_PASSWORD`, `SESSION_SECRET` e `DATA_IMPORT_TOKEN` como secrets.
3. Faça um deployment inicial com `npm run deploy`.
4. Guarde o mesmo `DATA_IMPORT_TOKEN` no `.dev.vars` local ignorado pelo Git, defina `$env:MIGRATION_URL` com o endereço `https://...workers.dev` e execute `npm run migrate:data`.
5. Depois de confirmar o conteúdo importado, remova o token: `npx wrangler secret delete DATA_IMPORT_TOKEN`.

A rota de migração recusa pedidos sem o token e deixa de aceitar importações quando o secret for removido.

No desenvolvimento local, inicie `npm run preview` num terminal e, noutro, execute `npm run migrate:data -- --url http://127.0.0.1:8787`. O importador lê o token de `.dev.vars`. A importação é repetível: objetos R2 são gravados nas mesmas chaves e registos D1 são atualizados por ID. Os dados originais não são apagados.

## Segredos e deployment

Antes do primeiro deployment, defina os segredos sem os colocar no `wrangler.jsonc`, GitHub ou frontend:

```powershell
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
npx wrangler secret put DATA_IMPORT_TOKEN
```

Use a senha administrativa atual como `ADMIN_PASSWORD`, um valor aleatório com pelo menos 32 caracteres para `SESSION_SECRET` e um token aleatório dedicado para `DATA_IMPORT_TOKEN`. O nome de utilizador é migrado de `data/gallery.json`. Depois da migração, remova o token de importação com `npx wrangler secret delete DATA_IMPORT_TOKEN`. A rota de entrada configurada por padrão é `/entrar-8f3k2x`; podes alterá-la em `vars.ADMIN_LOGIN_PATH` e em `assets.run_worker_first`.

```powershell
npm ci
npm run build
npm run preview
npm run deploy
```

`npm run build` valida o Worker, a configuração Wrangler e os assets sem publicar. `npm run preview` inicia o Worker localmente. `npm run deploy` publica com Wrangler; não foi executado durante esta migração.

## Desenvolvimento local

```powershell
Copy-Item .dev.vars.example .dev.vars
# Define ADMIN_PASSWORD, SESSION_SECRET e DATA_IMPORT_TOKEN com valores aleatórios locais.
npm run db:local
npm run dev
```

Num segundo terminal, com o Worker local a correr, importe os dados com `npm run migrate:data -- --url http://127.0.0.1:8787`.

`data/`, `.dev.vars` e os dados locais do Wrangler são ignorados pelo Git. Nunca coloques senhas ou tokens em ficheiros versionados.

## Verificações

```powershell
npm test
npm run lint
npm run build
```
