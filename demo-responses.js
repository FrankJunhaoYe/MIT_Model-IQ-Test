/* Local fixtures for the waiting/report demonstration. No API request is made. */
window.MITDemoResponses = {
  colorblind: `按题目的预设，女孩混淆红绿，父亲却能分辨。红绿色盲按 X 染色体隐性遗传推理，色盲女孩的亲生父亲应当也是色盲。因此他怀疑女孩并非自己亲生。
现实中，仅凭用错笔不能证明色盲；这是题目预设下的逻辑结论。
FINAL_ANSWER: {"daughter_colorblind":true,"father_colorblind":false,"biological_father":false}`,
  candy: `最少取 21 颗：9 颗圆形和 12 颗五角星。
圆形西瓜只有 8 颗，因此 9 颗圆形中一定有苹果或桃子。12 颗五角星中一定同时有苹果和桃子，能够配成目标组合。
FINAL_ANSWER: 21`,
  pelican: `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;background:#f5efe3;color:#454b43;font-family:serif;text-align:center;padding:24px 12px}h1{font-size:24px;font-weight:400;margin:8px}p{font-size:13px;color:#757b6d}svg{width:100%;max-width:620px;display:block;margin:12px auto}button{background:#e3e6d7;color:#454b43;border:1px solid #899181;border-radius:6px;padding:10px 22px;cursor:pointer}
.wheel{transform-box:fill-box;transform-origin:center;animation:turn 2s linear infinite}.rider{animation:bob 2s ease-in-out infinite}.scarf{transform-origin:303px 142px;animation:breeze 2s ease-in-out infinite}.cloud{animation:drift 12s ease-in-out infinite alternate}
@keyframes turn{to{transform:rotate(360deg)}}@keyframes bob{50%{transform:translateY(-3px)}}@keyframes breeze{50%{transform:rotate(-7deg)}}@keyframes drift{to{transform:translateX(-30px)}}.paused *{animation-play-state:paused!important}@media(prefers-reduced-motion:reduce){*{animation:none!important}}
</style></head><body><p>预置演示作品 · 非模型生成结果</p><h1>海风慢一点</h1><p>沿着海岸，捎一段轻轻的午后。</p>
<svg viewBox="0 0 620 330" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="围着砖红围巾的鹈鹕骑着青绿色自行车，沿海岸前行">
<rect width="620" height="330" fill="#f5efe3"/><circle cx="500" cy="65" r="30" fill="#e5c48e"/>
<g class="cloud" fill="#fffaf0"><ellipse cx="145" cy="63" rx="47" ry="10"/><ellipse cx="170" cy="55" rx="25" ry="15"/></g>
<path d="M0 190 Q140 176 295 190 T620 188 V267 H0Z" fill="#b9cfca"/><path d="M0 254 Q175 239 342 254 T620 246 V330 H0Z" fill="#dce0c8"/>
<path d="M0 296H620" stroke="#999d83" stroke-width="2"/><g fill="none" stroke="#50564e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
<g class="wheel"><circle cx="206" cy="250" r="43" fill="#e9e6d9" stroke="#454d49" stroke-width="7"/><circle cx="206" cy="250" r="36" stroke="#b0b8ac"/><path d="M206 214V286M170 250H242M181 225L231 275M181 275L231 225" stroke="#9aa797"/></g>
<g class="wheel"><circle cx="409" cy="250" r="43" fill="#e9e6d9" stroke="#454d49" stroke-width="7"/><circle cx="409" cy="250" r="36" stroke="#b0b8ac"/><path d="M409 214V286M373 250H445M384 225L434 275M384 275L434 225" stroke="#9aa797"/></g>
<path d="M206 250L253 179L296 250H206L363 179L296 250M363 179L409 250M253 179L363 179M253 179L244 165M363 179L357 150" stroke="#608f89" stroke-width="8"/>
<path d="M344 150H377" stroke="#585f54" stroke-width="7"/><path d="M230 163H263" stroke="#8d6754" stroke-width="9"/>
<g class="rider"><path d="M271 174L291 205L286 245M301 175L314 212L298 253" stroke="#cc9a62" stroke-width="9"/>
<ellipse cx="277" cy="145" rx="45" ry="37" fill="#f9f7ed"/><path d="M256 135Q280 126 297 150Q278 175 256 154Z" fill="#c3c8b4"/>
<path d="M300 135Q299 107 313 88Q334 67 348 91L333 137" fill="#f9f7ed"/><path d="M341 94L402 104L345 123Q334 114 341 94Z" fill="#d9aa69"/><path d="M343 104L398 105" stroke="#b58a53"/><circle cx="332" cy="91" r="3" fill="#444d43" stroke="none"/>
<path d="M307 134L332 141" stroke="#b56f58" stroke-width="9"/><path class="scarf" d="M309 140Q280 131 249 137L259 151Q284 143 309 147Z" fill="#b56f58" stroke="#965e4e" stroke-width="2"/>
<path d="M297 145L327 164L352 152" stroke="#c3c8b4" stroke-width="9"/></g></g>
</svg><button onclick="document.body.classList.toggle('paused');this.textContent=document.body.classList.contains('paused')?'继续':'暂停'">暂停</button>
</body></html>`,
};
