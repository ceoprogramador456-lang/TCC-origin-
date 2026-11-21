# Pareamento de um medidor SIVA

Ao ligar uma placa nova, o operador precisa ter acesso ao display do medidor e ao painel da empresa. O setor e o ativo monitorado devem estar cadastrados. A aprovação cria o ESP32 e o primeiro sensor na mesma transação. Assim, a primeira leitura já tem um destino no dashboard.

## Preparar a instalação

1. Configure a API com Node.js 22, MySQL 8.4 e as variáveis da instalação. `PAIRING_COMPANY_ID` é o ID de uma empresa existente. A API associa a descoberta à empresa configurada no servidor. Em instalações de empresas diferentes que compartilhem o banco, direcione cada placa ao endereço da API da sua instalação.
2. Gere `PAIRING_KEY` com `openssl rand -hex 32` e guarde-a com os segredos do servidor. As réplicas que atendem a mesma instalação precisam compartilhar a chave entre reinicializações. A troca da chave durante a aprovação pode invalidar códigos e retiradas em andamento. Use um `JWT_SECRET` independente, aleatório e com pelo menos 32 caracteres em produção.
3. Em uma instalação Prisma existente, use `npm ci`, `npm run prisma:generate` e `npm run prisma:deploy`. A migração acrescenta colunas opcionais a `esp32` e cria `device_pairing`. Se o banco foi instalado pelo conjunto SQL manual e já recebeu a migração 002, aplique `db/migrations/003_device_pairing.sql` uma vez pelo mesmo processo. Ao atualizar dados existentes, use apenas a trilha de migração que já administra esse banco.
4. Para a implantação com Caddy, aponte o DNS de `SIVA_API_DOMAIN` para o servidor, disponibilize as portas 80 e 443 e configure também `MYSQL_ROOT_PASSWORD`, `JWT_SECRET`, `CORS_ORIGIN`, `PAIRING_COMPANY_ID` e `PAIRING_KEY`. Para o compose fornecido, uma senha MySQL aleatória em hexadecimal pode ser usada diretamente na URL de conexão. Execute `docker compose -f docker-compose.enterprise.yml up -d --build`. O proxy recebe HTTPS e é a única entrada pública para a API. O compose define um salto confiável entre eles. Cadastre a empresa, o setor e o ativo antes de ligar as placas.
5. Sirva o painel por HTTPS. Quando o domínio da API for diferente do domínio do painel, defina `VITE_API_URL=https://<domínio-da-api>/api` antes de compilar o frontend e permita a origem do painel em `CORS_ORIGIN`.
6. Em `firmware/src`, copie `secrets.h.example` para `secrets.h`. Em `API_HOST`, use o nome que consta no certificado do servidor. `API_PORT` tem padrão 443. Cole o certificado público da CA em PEM em `API_ROOT_CA`. A placa precisa conseguir sincronizar o relógio por NTP para validar a conexão. O arquivo de exemplo acompanha o firmware e o arquivo local fica fora do Git. Com o PlatformIO, use `pio run -d firmware` para compilar e `pio run -d firmware -t upload` para gravar a placa selecionada.

## Cadastrar um equipamento

1. Ligue a placa e conecte-a ao Wi-Fi. Pelo monitor serial a 115200 baud, envie uma linha JSON no formato `{"ssid":"nome-da-rede","password":"senha-da-rede"}`. Também é possível usar a rede `SIVA-setup` com a senha temporária exibida no OLED. O ESP32 envia a identificação do dispositivo e do sensor à API. O display mostra um código de seis algarismos, válido por dez minutos.
2. Abra **Dispositivos** com uma conta de gestor da empresa ou de administrador. A lista **Aguardando aprovação** consulta a API a cada dez segundos. Localize o MAC da placa e selecione **Conferir código**.
3. Digite o código do OLED, escolha o setor e o ativo ao qual o sensor está ligado. Você pode dar um nome ao medidor. Clique em **Aprovar**.
4. A placa retira a credencial individual por HTTPS, grava-a na NVS e confirma a gravação. Após a primeira leitura aceita, confira o setor, o último contato e o estado de conexão no painel. A janela de conexão é de dez minutos.

## Contrato entre a placa, o painel e a API

As rotas abaixo têm o prefixo `/api/devices`. Respostas de sucesso com corpo usam `{ "success": true, "data": ... }`. As respostas de falha incluem `error.code` e `error.message`. Envie os segredos em cabeçalhos e o código em corpo JSON.

| Chamada | Identificação | Resultado |
| --- | --- | --- |
| `POST /discovery` | `X-Pairing-Secret` com 32 bytes aleatórios em hexadecimal, gerados pela placa | Recebe `mac`, `firmwareVersion`, `model`, `sensorId`. Retorna `sessionId`, `code` e `expiresAt`. A repetição com a mesma sessão recupera o código. |
| `GET /pending` | JWT de ADMIN ou GESTOR | Lista pendências visíveis ao usuário, com identificador de sessão, equipamento, sensor, empresa e validade. |
| `POST /pairing/:id/approve` | JWT de ADMIN ou GESTOR | Recebe `code`, `setorId`, `ativoId` e `descricao` opcional. Devolve o cadastro público. |
| `POST /pairing/:id/reject` | JWT de ADMIN ou GESTOR | Encerra a solicitação com HTTP 204. |
| `POST /pairing/status` | Segredo temporário e `{ "sessionId": "…" }` | Devolve `pending`, `approved`, `rejected` ou `expired`. |
| `POST /credentials` | Segredo temporário e `sessionId` | Devolve `token` e `espId`. Após a aprovação, a placa tem dez minutos para retirar a credencial. Pode repetir a retirada se perder a resposta. |
| `POST /pairing/ack` | `X-Token` da placa e `sessionId` | Confirma a gravação em NVS e encerra a retirada. Repetir a confirmação devolve 204. |
| `GET /me` | `X-Token` | Valida a credencial salva e retorna o `espId`. |
| `POST /:id/revoke` | JWT de ADMIN ou GESTOR | Invalida a credencial e mantém dispositivo, sensor e histórico. |

As leituras continuam em `POST /api/readings`, com `X-Token` e os campos `esp_id`, `sensor_id` e `vazao`. O MAC identifica a placa. O conhecimento do segredo temporário permite retirar a credencial da sessão aprovada. O código do OLED comprova o acesso físico de quem autoriza.

## Recuperação

- **Código expirado ou rejeitado.** Aguarde a nova sessão e confira o código atual no equipamento. Cinco tentativas incorretas encerram a sessão. Uma placa já aprovada que perdeu a janela de retirada requer revogação pelo painel antes de um novo pareamento.
- **Falha de rede ou API indisponível.** A medição local continua durante a interrupção. O backend volta a receber as próximas amostras após a reconexão. As amostras do intervalo offline ficam sem registro no servidor. Restabeleça a conectividade e confira o último contato. O equipamento pode reapresentar o segredo da sessão ou a credencial persistida. O painel volta a atualizar os dados quando a API responde.
- **Troca de credencial.** Use **Revogar**, volte ao equipamento e aprove a nova sessão com o mesmo setor, ativo e sensor. O cadastro mantém seus IDs e a série de leituras. A credencial antiga passa a receber HTTP 401.
- **Equipamento anterior à migração.** As credenciais válidas continuam aceitas em `POST /api/readings`. Cadastros anteriores podem ter MAC ausente. Se atualizar o firmware de um deles e iniciar o primeiro pareamento, será criado um novo vínculo para as próximas leituras. O histórico antigo continua no cadastro anterior. Verifique se a instalação já usou a credencial pública do antigo seed de demonstração e revogue esse cadastro pelo painel.

## Verificação

Execute `npm test` para verificar o contrato com a persistência em memória. Os testes de pareamento cobrem descoberta repetida, escopo de empresa, permissão, expiração, limitação de tentativas, aprovações concorrentes, rejeição, retirada repetida, confirmação, revogação e leitura com o vínculo recuperado.

No ensaio integrado desta refatoração, o painel no Edge mostrou uma placa simulada por consulta periódica e aprovou o código. A API retomou a sessão depois de duas reinicializações utilizando MySQL 8.4.13. A placa simulada confirmou a retirada e enviou uma leitura por HTTPS. Quatro descobertas simultâneas da mesma placa produziram uma sessão. Em quatro aprovações simultâneas, uma foi aceita e as demais receberam HTTP 409. A migração também foi aplicada sobre um cadastro e uma leitura anteriores, com conferência dos vínculos pelo banco.

Para a validação em bancada, grave uma placa, acompanhe a vazão e o código no OLED, desligue a alimentação após aprovar e ligue novamente. Interrompa e restabeleça o Wi-Fi e confirme que as próximas leituras aparecem no mesmo sensor. Registre o MAC, a versão do firmware e os horários observados durante esse ensaio.
