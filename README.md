# ukai — 輪

体・脳・心・魂（PHYSICAL / BRAIN / MIND / SOUL）を、ゲームのステータス画面のように育てていく自分用ページ。

- **STATUS**：自分で項目を足す・名前を変える・消す。値（0〜100）と目標値、「伸ばしたいこと」を書ける
- **QUESTS**：やりたいことを書く。達成すると EXP が入り、つないだ項目の値が上がる
- **LV / EXP**：クエスト達成でレベルが上がる
- **BALANCE**：いまの値と目標値のレーダーチャート
- 書き出し / 読み込み（JSON）でバックアップ

## 動かし方

### Docker（推奨）

```sh
docker compose up -d --build
# → http://<ホストのIP>:8080
```

データは名前付きボリューム `wa-data`（コンテナ内 `/data/state.json`）に保存される。

```sh
# バックアップ
docker compose cp wa:/data/state.json ./state-backup.json
# 止める（データは残る）
docker compose down
```

### Docker を使わない場合

```sh
npm install
node server.js        # Node.js 18 以上
# → http://localhost:8080 、データは ./data/state.json
```

`public/index.html` をブラウザで直接開いても動く。その場合、データはそのブラウザの localStorage に入る。

## Claude と一緒に使う（MCP）

サーバーの `/mcp` が MCP の入口になっている。Claude をつなぐと、輪のデータを読んで提案し、了承した内容だけを書き込める。

### つなぎ方

**Claude Code**（同じ LAN 内の PC から）

```sh
claude mcp add --transport http wa http://<ホストのIP>:8080/mcp
# トークンを設定した場合
claude mcp add --transport http wa http://<ホストのIP>:8080/mcp --header "Authorization: Bearer <トークン>"
```

**Claude デスクトップアプリ**：`claude_desktop_config.json` に、HTTP の MCP を中継する `mcp-remote` を書く（Node.js が必要）。

```json
{
  "mcpServers": {
    "wa": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://<ホストのIP>:8080/mcp", "--allow-http"]
    }
  }
}
```

claude.ai（Web・スマホ）の「カスタムコネクタ」は、インターネットから HTTPS で届くサーバーが前提。家の LAN の中だけなら使えない。

### 使い方の例

- 「輪の状態を見て、次のクエストを 3 つ提案して」
- 「NETWORK の目標を 90 にして、伸ばしたいことに『障害を一人で切り分ける』と書いて」
- 「今日の睡眠は 40、気分は 70」
- MCP のプロンプト `review` を選ぶと、ふりかえりと提案をまとめて頼める

### 道具の一覧

| 道具 | 内容 |
|---|---|
| `wa_get_status` | 状態を読む（読み取りのみ） |
| `wa_add_stat` / `wa_update_stat` / `wa_delete_stat` | 項目の追加・編集・削除 |
| `wa_record_value` | 項目の値を記録 |
| `wa_add_quest` / `wa_update_quest` / `wa_delete_quest` | クエストの追加・編集・削除 |
| `wa_set_quest_done` | クエストの達成／取り消し（EXP と項目の値が動く） |

書き込み系の道具には「ユーザーが了承してから呼ぶ」と書いてある。Claude アプリ側でも、道具を使うたびに許可を求める設定にしておくと安心。

### 画面との同時編集

画面はフォーカスが戻ったときと 15 秒ごとに最新を読み直す。Claude が書いた直後に画面で古い状態のまま保存しようとすると、上書きせずに最新を読み込み直す（その操作はやり直しになる）。

### トークン

`.env` に `WA_MCP_TOKEN=<長いランダム文字列>` を書いて `docker compose up -d` すると、`/mcp` に `Authorization: Bearer <トークン>` が必要になる。画面（`/api/state`）には認証がない点は変わらない。

## 注意

認証はない。家の LAN の中だけで使うこと。外に出すなら、リバースプロキシで Basic 認証や VPN を前に置く。

## 構成

| パス | 内容 |
|---|---|
| `server.js` | 静的ファイル配信、`GET/PUT /api/state`、`POST /mcp`、`/healthz` |
| `store.js` | データの読み書き（版番号による衝突検知） |
| `mcp.js` | MCP の道具とプロンプト |
| `public/index.html` | 画面のすべて |
| `public/assets/ouroboros.jpg` | 中央の蛇の絵 |
| `public/assets/legacy-standalone.html` | 以前作った「輪 — 動く絵」 |
