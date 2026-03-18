# SimScope

RoboCup Rescue Simulation (RCRS) のビジュアライザです。カーネルにリアルタイム接続してシミュレーションを観察したり、ログファイルを再生したりできます。

## 使い方

### Docker（推奨）

```sh
docker run --rm -p 3000:3000 ghcr.io/shima004/simscope:main
```

ブラウザで <http://localhost:3000> を開いてください。

### ソースから起動

```sh
npm install
npm run dev
```

---

## 接続方法

### リアルタイム接続（カーネルが起動中の場合）

1. 左上パネルの **TCP Server** にカーネルのホストとポートを入力
   - デフォルト: `localhost` / `27931`
2. **Connect** ボタンをクリック
3. `● Connected` と表示されたらシミュレーションが始まるのを待つ

#### WSL2上でホストのカーネルに接続する場合

起動時に`--add-host` オプションでホストマシンへのルートを追加します。

```sh
docker run --rm -p 3000:3000 \
  --add-host=host.docker.internal:host-gateway \
  ghcr.io/shima004/simscope:main
```

ControlPanelの接続先を以下のように入力してください。

- Host: `host.docker.internal`
- Port: `27931`

### ログファイルの再生

1. **Open 7z log** ボタンをクリック
2. `.7z` 形式のログファイルを選択
3. 読み込み後、スライダーやボタンで再生操作

| ボタン     | 動作                |
| ---------- | ------------------- |
| Play/Pause | 自動再生 / 一時停止 |
| Prev       | 1ステップ戻る       |
| Next       | 1ステップ進む       |

---

## 画面の見方

- **マップ** — 建物・道路・エージェントを地図上に表示
- **InfoPanel** — 選択したエンティティの詳細情報
- **CivilianStatusPanel** — 市民の生存・埋没状況
- **InjuredCivilianPanel** — 各避難所の負傷者数
- **ScorePanel** — 瓦礫修理コスト・市民スコア
- **Follow ON/OFF** — 選択中のエージェントにカメラを追従
