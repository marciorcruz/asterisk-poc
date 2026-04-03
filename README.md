# WebPhone LAN Lab

Projeto base para rodar um servidor Asterisk na rede local e um webphone WebRTC no navegador.

## Estrutura

- `docker-compose.yml`: sobe o Asterisk e um Caddy para servir o frontend em HTTPS.
- `asterisk/config`: arquivos principais do PBX.
- `asterisk/scripts/generate-certs.sh`: gera o certificado TLS inicial do Asterisk.
- `webphone`: frontend em React + TypeScript + SIP.js com suporte a PWA.

## Pré-requisitos

- Docker e Docker Compose
- Node.js 20+
- OpenSSL
- Dois nomes locais apontando para a mesma máquina, por exemplo `pbx.local.lan` e `phone.local.lan`

## Passo a passo

1. Gere o certificado do Asterisk:

```bash
chmod +x asterisk/scripts/generate-certs.sh
./asterisk/scripts/generate-certs.sh pbx.local.lan
```

2. Ajuste o DNS local ou `/etc/hosts` para apontar o nome do PBX para a máquina:

```text
192.168.1.10 pbx.local.lan
192.168.1.10 phone.local.lan
```

3. Edite o [Caddyfile](/home/marciorcruz/Documents/webphone/reverse-proxy/Caddyfile) se quiser trocar `phone.local.lan` por outro hostname local.

4. Instale as dependências do frontend e gere o build:

```bash
cd webphone
npm install
npm run build
cd ..
```

5. Suba a stack:

```bash
docker compose up -d
```

6. Acesse o frontend em `https://phone.local.lan` e use o PBX em `wss://pbx.local.lan:8089/ws`.

## Ramais de teste

- `1001 / SenhaForte123`
- `1002 / SenhaForte456`

## Destinos úteis

- `1001` chama o outro navegador registrado como 1001
- `1002` chama o outro navegador registrado como 1002
- `2000` eco
- `3000` playback

## Portas importantes

- `8088/tcp`: HTTP do Asterisk
- `8089/tcp`: HTTPS/WSS do Asterisk
- `5060/udp`: SIP clássico opcional
- `10000-10100/udp`: RTP
- `443/tcp`: frontend HTTPS pelo Caddy

## Observações

- O navegador vai exigir certificado confiável para o fluxo WebRTC ficar estável.
- O `Caddyfile` usa `tls internal`, bom para laboratório. No Android, importe a CA local do Caddy se quiser evitar alertas.
- O frontend e o PBX usam certificados separados: um emitido pelo Caddy para `phone.local.lan` e outro gerado por `generate-certs.sh` para `pbx.local.lan`.
- Para chamadas externas ou fora da LAN, será preciso revisar NAT, ICE e STUN/TURN.
