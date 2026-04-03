# Asterisk PoC

PoC de telefonia para rede local com:

- `Asterisk 22` para SIP/WebRTC
- `Caddy` servindo o frontend em HTTPS
- `API Go` para cadastro, login e provisionamento automático de ramais
- `React + SIP.js` para o webphone no navegador
- suporte a áudio, vídeo e instalação como PWA

## Arquitetura

```text
Browser / PWA
  ├─ HTTPS  -> Caddy -> frontend React
  ├─ /api/* -> Caddy -> API Go
  └─ /ws    -> Caddy -> Asterisk HTTP/WebSocket

API Go
  ├─ SQLite para usuários
  ├─ gera pjsip_users.conf
  └─ executa `pjsip reload` via AMI

Asterisk
  ├─ PJSIP WebRTC
  ├─ áudio: opus, ulaw, alaw
  └─ vídeo: vp8, h264
```

## Estrutura

```text
.
├── api/                    # backend de autenticação e provisionamento
├── asterisk/config/        # configs do Asterisk
├── asterisk/scripts/       # scripts auxiliares
├── data/                   # banco SQLite
├── reverse-proxy/          # Caddy
├── webphone/               # frontend React + PWA
├── docker-compose.yml
└── README.md
```

## Pré-requisitos

- Docker e Docker Compose
- Node.js 20+
- OpenSSL
- hostnames locais apontando para a máquina do projeto

Exemplo de `/etc/hosts`:

```text
192.168.0.102 phone.local.lan
192.168.0.102 pbx.local.lan
```

Observação:

- hoje o [Caddyfile](./reverse-proxy/Caddyfile) está configurado para `phone.local.lan` e `https://192.168.0.102`
- o frontend usa `wss://<host-atual>/ws`, então o ideal é abrir sempre pelo mesmo host servido pelo Caddy

## Serviços

### Asterisk

- arquivo principal: [asterisk/config/pjsip.conf](./asterisk/config/pjsip.conf)
- transporte WebRTC atual: `transport-ws`
- codecs habilitados:
  - áudio: `opus`, `ulaw`, `alaw`
  - vídeo: `vp8`, `h264`

### API

- exposta em `:8080` internamente
- rotas:
  - `POST /api/register`
  - `POST /api/login`
  - `GET /api/me`
- ao cadastrar usuário:
  - grava no SQLite
  - gera ramal SIP automático
  - atualiza [asterisk/config/pjsip_users.conf](./asterisk/config/pjsip_users.conf)
  - faz `pjsip reload` via AMI

### Caddy

- HTTPS local para o frontend
- proxy para:
  - `/api/*` -> API Go
  - `/ws` -> Asterisk HTTP/WebSocket

### Frontend

- React + TypeScript + Vite
- SIP.js no browser
- login/cadastro
- discador
- chamadas de áudio
- chamadas de vídeo WebRTC
- PWA instalável

## Subindo o projeto

### 1. Gerar certificado do Asterisk

```bash
chmod +x asterisk/scripts/generate-certs.sh
./asterisk/scripts/generate-certs.sh pbx.local.lan
```

### 2. Build do frontend

```bash
cd webphone
npm install
npm run build
cd ..
```

### 3. Subir os containers

```bash
docker compose up -d --build
```

### 4. Acessar

- frontend: `https://phone.local.lan`
- alternativa local já prevista no Caddy: `https://192.168.0.102`

## Comandos úteis

### Rebuild do frontend

```bash
cd webphone
npm run build
```

### Reload do Asterisk

```bash
docker compose exec asterisk asterisk -rx "core reload"
```

### Reload só do PJSIP

```bash
docker compose exec asterisk asterisk -rx "pjsip reload"
```

### Ver endpoints carregados

```bash
docker compose exec asterisk asterisk -rx "pjsip show endpoints"
```

### Ver um endpoint específico

```bash
docker compose exec asterisk asterisk -rx "pjsip show endpoint 2000"
```

### Logs dos containers

```bash
docker compose logs -f asterisk
docker compose logs -f api
docker compose logs -f caddy
```

## Ramais

Ramais fixos de laboratório:

- `1001 / SenhaForte123`
- `1002 / SenhaForte456`

Ramais dinâmicos:

- criados pela API a partir do cadastro
- gravados em [asterisk/config/pjsip_users.conf](./asterisk/config/pjsip_users.conf)

## Destinos de teste

- `1001`: teste entre navegadores
- `1002`: teste entre navegadores
- `2000`: eco
- `3000`: playback

## Vídeo

O projeto já está preparado para vídeo entre ramais WebRTC, mas há alguns cuidados importantes:

- o chamador deve iniciar a chamada com vídeo quando quiser vídeo
- o receptor agora responde com vídeo automaticamente se a oferta recebida contiver `m=video`
- o navegador precisa ter permissão de câmera
- para testes consistentes, use dois navegadores ou dois dispositivos

Se o vídeo ficar preto:

- faça hard refresh nos dois lados
- confirme que o acesso foi pelo host HTTPS do Caddy
- confira permissão de câmera no navegador
- verifique se o endpoint negocia `vp8` ou `h264`

## Portas importantes

- `443/tcp`: frontend HTTPS no Caddy
- `8080/tcp`: API Go
- `8088/tcp`: HTTP/WebSocket do Asterisk
- `8089/tcp`: HTTPS do Asterisk
- `5038/tcp`: AMI local
- `5060/udp`: SIP UDP opcional
- `10000-10100/udp`: RTP

## Arquivos principais

- [docker-compose.yml](./docker-compose.yml)
- [reverse-proxy/Caddyfile](./reverse-proxy/Caddyfile)
- [asterisk/config/pjsip.conf](./asterisk/config/pjsip.conf)
- [asterisk/config/pjsip_users.conf](./asterisk/config/pjsip_users.conf)
- [asterisk/config/manager.conf](./asterisk/config/manager.conf)
- [webphone/src/App.tsx](./webphone/src/App.tsx)
- [api/main.go](./api/main.go)

## Limitações atuais

- configuração pensada para laboratório em LAN
- host/IP do Caddy ainda está parcialmente fixo em [reverse-proxy/Caddyfile](./reverse-proxy/Caddyfile)
- vídeo WebRTC ainda está em fase de estabilização
- o repositório hoje contém artefatos locais que podem ser limpos depois

## Próximos passos sugeridos

- parametrizar hostname e IP do Caddy por variável
- limpar artefatos do repositório e melhorar `.gitignore`
- adicionar tela de contatos e histórico
- melhorar observabilidade de chamadas WebRTC
- preparar TURN/NAT para uso fora da LAN
