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
node server.js        # Node.js 18 以上。依存パッケージなし
# → http://localhost:8080 、データは ./data/state.json
```

`public/index.html` をブラウザで直接開いても動く。その場合、データはそのブラウザの localStorage に入る。

## 注意

認証はない。家の LAN の中だけで使うこと。外に出すなら、リバースプロキシで Basic 認証や VPN を前に置く。

## 構成

| パス | 内容 |
|---|---|
| `server.js` | 静的ファイル配信と `GET/PUT /api/state`、`/healthz` |
| `public/index.html` | 画面のすべて |
| `public/assets/ouroboros.jpg` | 中央の蛇の絵 |
| `public/assets/legacy-standalone.html` | 以前作った「輪 — 動く絵」 |
