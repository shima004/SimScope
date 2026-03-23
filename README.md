# SimScope

![SimScope](https://github.com/user-attachments/assets/44532178-f40d-4d9c-bec3-4a4aa0079a61)

RoboCup Rescue Simulation (RCRS) のビジュアライザです。カーネルにリアルタイム接続してシミュレーションを観察したり、ログファイルを再生したりできます。

## 使い方

### GitHub Pages（ファイル再生のみ）

ブラウザから直接利用できます。インストール不要です。

<https://shima004.github.io/SimScope/>

> TCP接続・URLロードはサポートしていません。ローカルのログファイルの再生のみ対応しています。

### Docker（推奨）

```sh
docker run --rm -p 3000:3000 ghcr.io/shima004/simscope:latest
```

ブラウザで <http://localhost:3000> を開いてください。

### ソースから起動

```sh
npm install
npm run dev
```

---

## 接続方法

### ログファイルの再生

1. **Open 7z tgz tar.gz xz log file** ボタンをクリック
2. ログファイルを選択
3. 読み込み後、スライダーやボタンで再生操作

### URLからロード

ControlPanelの **Log File** の URL 欄にログファイルの URL を入力して **Load** をクリック。

### リアルタイム接続（カーネルが起動中の場合）

> **注意**: リアルタイム接続ではビューア向けのログデータのみ受信するため、一部機能（Perception表示など）は利用できません。フル機能を使うにはログファイルの読み込みを推奨します。

1. 左上パネルの **TCP Server** にカーネルのホストとポートを入力
   - デフォルト: `localhost` / `27931`
2. **Connect** ボタンをクリック
3. `● Connected` と表示されたらシミュレーションが始まるのを待つ

#### WSL2上でホストのカーネルに接続する場合

起動時に`--add-host` オプションでホストマシンへのルートを追加します。

```sh
docker run --rm -p 3000:3000 \
  --add-host=host.docker.internal:host-gateway \
  ghcr.io/shima004/simscope:latest
```

ControlPanelの接続先を以下のように入力してください。

- Host: `host.docker.internal`
- Port: `27931`

---

## URL パラメータ

URLにクエリパラメータを付けることで、起動時の動作を設定できます。

| パラメータ | 例                                | 説明                                    |
| ---------- | --------------------------------- | --------------------------------------- |
| `host`     | `?host=192.168.1.10`              | TCP接続先のホスト                       |
| `port`     | `?port=27931`                     | TCP接続先のポート                       |
| `url`      | `?url=https://example.com/log.7z` | 起動時に自動ロードするログファイルのURL |
| `team`     | `?team=TeamName`                  | 画面に表示するチーム名                  |

複数のパラメータを組み合わせることもできます。

```text
http://localhost:3000/?host=192.168.1.10&port=27931&team=MyTeam
```

```text
http://localhost:3000/?url=https://example.com/log.7z&team=MyTeam
```

---

## 操作方法

### 再生コントロール

| ボタン                   | 動作                |
| ------------------------ | ------------------- |
| Play / Pause             | 自動再生 / 一時停止 |
| Prev                     | 1ステップ戻る       |
| Next                     | 1ステップ進む       |
| 0.5x / 1x / 2x / 4x / 8x | 再生速度の変更      |

### エンティティ操作

- **マップ上をクリック** — エンティティを選択（何もない場所をクリックで選択解除）
- **Follow** — 選択中のエージェントにカメラを追従
- **Perception** — 選択中のエージェント/司令塔の知覚している世界の描画に切り替える（エージェント・司令塔選択時のみ有効）
- **⚙️** — カーネル設定を表示

---

## 画面の見方

- **マップ** — 建物・道路・エージェントを地図上に表示
- **InfoPanel** — 選択したエンティティの詳細情報・通信ログ
  - **📌** — エンティティをピン留めして常に表示
- **CivilianStatusPanel** — 市民の生存・埋没状況（ヘッダークリックで折りたたみ可）
- **InjuredCivilianPanel** — 避難所におらず搬送状態ではない負傷市民の一覧
- **Score** — スコア
- **Injured in refuge** — 避難所にいる負傷市民の数/総負傷市民数
- **Blockade cleared** — 啓開された瓦礫の全体での割合
