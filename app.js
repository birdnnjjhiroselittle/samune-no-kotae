import Anthropic from "https://esm.sh/@anthropic-ai/sdk";

const $ = (id) => document.getElementById(id);
const MODEL = "claude-opus-5-5";
const KEY_STORE = "samune-no-kotae.apikey";

let video = { id: "", url: "", title: "", author: "" };

// ---------- ① URL → 動画ID・サムネ・タイトル ----------
function parseVideoId(text) {
  try {
    const u = new URL(text.trim());
    if (u.hostname === "youtu.be") return u.pathname.slice(1).split("/")[0];
    if (u.hostname.endsWith("youtube.com")) {
      if (u.searchParams.get("v")) return u.searchParams.get("v");
      const m = u.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{11})/);
      if (m) return m[1];
    }
  } catch { /* not a URL */ }
  return "";
}

async function loadVideo() {
  const id = parseVideoId($("url").value);
  if (!id) { $("video").hidden = true; video = { id: "", url: "", title: "", author: "" }; return; }
  video.id = id;
  video.url = `https://youtu.be/${id}`;
  $("thumb").src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  $("title").textContent = "（タイトルを読み込み中…）";
  $("author").textContent = "";
  $("video").hidden = false;
  try {
    // 公開されている oEmbed 情報（タイトル・チャンネル名）だけを取得
    const r = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(video.url)}`);
    const j = await r.json();
    video.title = j.title || "";
    video.author = j.author_name || "";
  } catch { video.title = ""; video.author = ""; }
  $("title").textContent = video.title || "（タイトルを取得できませんでした）";
  $("author").textContent = video.author;
}

// ---------- ② 指示文 ----------
function buildPrompt() {
  const src = $("source").value.trim();
  return `あなたは学術系YouTube動画の内容を、忙しい人向けにX（旧Twitter）の1ポストにまとめる編集者です。

動画タイトル（サムネの問いに近いもの）: ${video.title || "（不明）"}
チャンネル: ${video.author || "（不明）"}

以下は動画の説明文または文字起こしです。
<source>
${src}
</source>

次の形で、全体を140字（全角）以内の日本語で書いてください。前置きや説明は書かず、本文だけを返してください。

【サムネの答え】（問いへの答えを1行で）
①（理由・根拠1）
②（理由・根拠2）
③（理由・根拠3）

ルール:
- 書いてあることだけを使い、書いていないことは推測で足さない。数字は原文のまま。
- 答えが原文から読み取れない場合は「【サムネの答え】説明文からは答えが読み取れません」とだけ書く。
- 出典やリンクは書かない（ツールが自動で付けます）。`;
}

function footer() {
  const who = video.author ? `出典：${video.author}` : "出典";
  return `\n${who} ${video.url}`.trimEnd();
}

// ---------- ③ AIでまとめる ----------
async function summarize() {
  const key = $("apikey").value.trim();
  if (!video.id) return setStatus("先に①で動画のURLを入れてください。", true);
  if (!$("source").value.trim()) return setStatus("②に説明文か文字起こしを貼ってください。", true);
  if (!key) return setStatus("APIキーがないときは「指示文をコピー」を使ってください。", true);
  localStorage.setItem(KEY_STORE, key);

  $("run").disabled = true;
  setStatus("AIがまとめています…");
  try {
    const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content: buildPrompt() }],
    });
    if (res.stop_reason === "refusal") {
      return setStatus("AIがこの内容のまとめを断りました。文章を変えて試してください。", true);
    }
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    $("out").value = text + footer();
    updateCount();
    setStatus("できました。④で確認してください。");
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) setStatus("APIキーが正しくないようです。", true);
    else if (e instanceof Anthropic.RateLimitError) setStatus("混み合っています。少し待ってからもう一度押してください。", true);
    else setStatus("エラー: " + (e?.message || e), true);
  } finally {
    $("run").disabled = false;
  }
}

async function copyPrompt() {
  if (!$("source").value.trim()) return setStatus("②に説明文か文字起こしを貼ってください。", true);
  await navigator.clipboard.writeText(buildPrompt());
  setStatus("指示文をコピーしました。AIに貼って、返ってきた答えを④に貼ってください（出典リンクは「Xの投稿画面を開く」のときに自動で付きます）。");
}

// ---------- ④ 文字数（Xの数え方：日本語は1字=2、URLは23）と投稿 ----------
function xLength(text) {
  const URL_RE = /https?:\/\/\S+/g;
  let len = 0;
  const rest = text.replace(URL_RE, () => { len += 23; return ""; });
  for (const ch of rest) {
    const c = ch.codePointAt(0);
    const light = c <= 4351 || (c >= 8192 && c <= 8205) || (c >= 8208 && c <= 8223) || (c >= 8242 && c <= 8247);
    len += light ? 1 : 2;
  }
  return len;
}

function updateCount() {
  const n = xLength($("out").value);
  $("count").textContent = `Xの文字数：${n} / 280（日本語ならおよそ${Math.ceil(n / 2)} / 140字）`;
  $("count").classList.toggle("over", n > 280);
}

function openX() {
  let text = $("out").value.trim();
  if (!text) return;
  if (video.url && !text.includes(video.url)) text += footer();
  window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}`, "_blank", "noopener");
}

function setStatus(msg, isErr = false) {
  $("status").textContent = msg;
  $("status").classList.toggle("err", isErr);
}

// ---------- つなぎこみ ----------
$("apikey").value = localStorage.getItem(KEY_STORE) || "";
$("url").addEventListener("change", loadVideo);
$("url").addEventListener("paste", () => setTimeout(loadVideo, 0));
$("run").addEventListener("click", summarize);
$("copyPrompt").addEventListener("click", copyPrompt);
$("out").addEventListener("input", updateCount);
$("post").addEventListener("click", openX);
$("copyOut").addEventListener("click", () => navigator.clipboard.writeText($("out").value));
updateCount();
