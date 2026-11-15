# lum. — galeria local de imagens

Este modo temporário substitui o Supabase por um arquivo JSON local. A galeria pública lê `data/gallery.json`; imagens reprocessadas ficam em `data/images/`, fora de `public/`. O diretório `data/` é ignorado pelo Git. Não use este armazenamento como banco de produção nem o compartilhe entre múltiplas instâncias/servidores.

## Requisitos e inicialização

1. Instale Node.js 20.9+ e execute `npm install`.
2. Crie sua configuração local:

   ```powershell
   Copy-Item .env.example .env.local
   notepad .env.local
   ```

3. Configure `LOCAL_ADMIN_PASSWORD` em `.env.local` com uma senha temporária. O valor não está incluído no código nem no `.env.example`. Nunca versione ou compartilhe `.env.local`.
4. Opcionalmente, ajuste `ADMIN_LOGIN_PATH` para um caminho longo e exclusivo e `MAX_UPLOAD_MB` (1–50; padrão 10 MB por arquivo). O limite máximo do corpo de uma função Vercel é menor; o painel avisa e aplica o limite de 4 MB quando executado na Vercel.
5. Execute `npm run dev` e acesse `http://localhost:3000`. O acesso via localhost é recomendado; a autenticação local não funciona pelo IP da rede nem em produção.
6. Abra o caminho definido por `ADMIN_LOGIN_PATH` (padrão `/entrar-8f3k2x`) e entre como `admin`. Ative TOTP no painel para exigir um código de autenticador nas próximas sessões.

O cadastro público não existe. `/admin` e suas sub-rotas retornam a página 404 pública a visitantes sem sessão; APIs administrativas negam requisições não autorizadas. A rota de login não é apresentada na navegação nem no sitemap, e recebe `noindex, nofollow`. Não considere o caminho secreto como controle de acesso: sessão assinada, papel, validação de origem e autenticação são verificados no servidor.

## Importação e gerenciamento

- O painel aceita até 50 itens por importação, somando arquivos locais e URLs HTTPS.
- Arquivos JPEG, PNG, WebP e GIF são validados por assinatura e decodificados/reprocessados com Sharp; SVG não é aceito. A imagem é redimensionada para no máximo 4096×4096, convertida para WebP e tem metadados removidos. Uma miniatura também é criada.
- Cada arquivo é limitado por `MAX_UPLOAD_MB` localmente. URLs são guardadas como links externos e carregadas pelo navegador; o servidor não as busca. Use URLs públicas e confiáveis.
- Tags removem `#`, espaços extras e são normalizadas para minúsculas.
- Edição, exclusão, tags, logout, auditoria local e configuração TOTP estão disponíveis no painel.

## Diagnóstico Supabase legado

O runtime local não depende de Supabase. Para investigar a conexão da configuração antiga, execute `npm run check:supabase`. O script lê `.env.local`, mostra apenas prefixos das chaves, testa REST/Auth, leitura de `images`/`tags` e o bucket `gallery`.

Na última execução registrada, as variáveis tinham formato aparente válido; REST e leitura de `images` expiraram (código `23`, operação abortada por timeout), Auth falhou com `ENOTFOUND` ao resolver o host Supabase e `tags`/bucket responderam HTTP 200. Isso aponta conectividade/DNS irregular, não prova que todas as credenciais estão corretas. Se voltar ao Supabase, confirme o host no painel do projeto, estado ativo, DNS do Windows e teste sem VPN/Radmin/Hamachi; verifique também firewall e antivírus.

As migrações antigas em `supabase/migrations/` são mantidas para a futura volta ao Supabase, mas não são necessárias para este modo local. No SQL Editor não execute `ALTER TABLE storage.objects`: o RLS de `storage.objects` já vem ativo.

## Armazenamento e limites de segurança

- O JSON e os WebPs não são servidos como arquivos estáticos. O JSON é validado com Zod e atualizado via arquivo temporário + rename; operações do mesmo processo são serializadas.
- IDs e nomes de arquivos são UUIDs; imagens ficam em pasta fora de `public/`, e a rota de leitura valida o UUID e a existência do registro.
- A sessão usa cookie `httpOnly`, `SameSite=Lax`, duração de 30 minutos e assinatura HMAC. A senha é comparada em tempo constante; tentativas têm limite em memória e bloqueio persistido após cinco falhas por 15 minutos. A auditoria guarda hashes de usuário/IP, nunca senhas ou IPs em claro.
- CSP e cabeçalhos anti-frame/MIME/referrer/permissions estão configurados. Dados de administração não são carregados para a galeria pública.
- O arquivo JSON não é criptografado. Proteja a conta do Windows e faça backup seguro de `data/`; qualquer processo que execute sob sua conta pode ler os arquivos. Este mecanismo é adequado apenas para testes locais, não substitui banco com controle de acesso, backups gerenciados e execução serverless.
- Rate limit em memória não coordena múltiplos processos. O armazenamento JSON também não suporta concorrência entre servidores, escalabilidade horizontal ou transações distribuídas.
- Use somente uma senha temporária para este modo local; defina outra senha antes de qualquer exposição à rede. Não publique o servidor local com acesso administrativo.

## Validação

```powershell
npm run typecheck
npm run lint
npm run build
```
