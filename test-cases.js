(function exposeTests(global) {
  'use strict';

  const tests = {
    colorblind: {
      name: '红绿色盲测试',
      keywords: ['遗传', '染色体', '非亲生', '不是亲生', '不是他亲生', '并非亲生', '并非自己亲生'],
      prompt: `有一天，一个女孩参加数学考试只得了 38 分。她心里对父亲的惩罚充满恐惧，于是偷偷把分数改成了 88 分。她的父亲看到试卷后，怒发冲冠，狠狠地给了她巴掌，怒吼道：“你这 8 怎么一半是绿的一半是红的，你以为我是傻子吗？”女孩被打后，委屈地哭了起来，什么也没说。
过了一会儿，父亲突然崩溃了。
请问：这位父亲为什么过一会儿崩溃了？他意识到了什么？
提示：这是逻辑推理题，而非情感题目。
请解释题目预期的逻辑及其成立所需的假设，可以指出现实中的推断局限。`,
      evaluate(text) {
        const matched = this.keywords.filter((keyword) => text.includes(keyword));
        const correct = matched.length > 0;
        return { state: correct ? 'correct' : 'incorrect', label: correct ? '正确' : '错误', detail: `扫描整段回答，命中任意关键词即通过。${correct ? `已命中：${matched.join('、')}` : '未命中关键词'}。` };
      },
    },
    candy: {
      name: '糖果测试',
      prompt: `三种口味，每种有圆形、五角星形两种形状，形状可凭手感分辨。预先决定取出数量，保证得到圆形苹果 + 五角星桃子，或者圆形桃子 + 五角星苹果。
形状       苹果  桃子  西瓜
圆形         7     9     8
五角星       7     6     4
取出前不能辨别口味，但可以凭手感选择形状，并预先决定两种形状各取多少颗；取出后可辨认口味。不放回。请求出保证目标组合的最少总颗数，给出两种形状的取出数量，并证明充分性与最小性。`,
      evaluate(text) {
        const correct = text.includes('21');
        return { state: correct ? 'correct' : 'incorrect', label: correct ? '正确' : '错误', detail: `${correct ? '已命中' : '未命中'}文本“21”。扫描整段回答，出现“21”即通过。` };
      },
    },
    pelican: {
      name: '鹈鹕测试',
      maxOutputTokens: 16384,
      timeoutMs: 180000,
      prompt: `生成一个可直接打开的 HTML 文件，使用 SVG 绘制鹈鹕骑自行车的 2D 动画，通过 CSS 或 JavaScript 实现车轮转动、双腿踩踏、身体轻微起伏、围巾随风摆动，以及背景缓慢移动，动作自然协调。
整体采用清新治愈的复古绘本风格：低饱和配色、手绘感线条、简洁平涂、充足留白，可加入轻微纸张质感。
鹈鹕和自行车必须分别拥有独立、明确的配色，不能仅用轮廓线表现，也不能与背景融为一体。鹈鹕的羽毛、嘴、腿和配饰应有分区填色；自行车的车架、轮胎、轮圈、车把与坐垫也应有各自的颜色。两者的主色应明显区分，同时与整体画面协调。颜色在动画过程中保持稳定，不随机闪变。
鹈鹕骑自行车是固定主题，其余细节保留适度随机性：每次生成时自行选择骑行环境、天气、时段、角色配饰，以及鹈鹕、自行车和背景的配色，让它们共同构成协调的小故事，避免机械拼凑。画面温柔、有趣，但不幼稚。
页面搭配一句与场景呼应的简短中文标题和少量氛围文案，并提供动画暂停／继续按钮。布局适配桌面和手机，主体清晰完整，避免元素重叠。
所有图形均用 SVG 绘制，不使用外部图片、字体或依赖。不要读取或参考任何本地文件，不需要运行测试。直接生成完整 HTML 文件。
仅检查返回文本包含 HTML 和 SVG，不自动评价画面、骑行动作或动画质量。作品在禁止外部资源的隔离窗口中展示。`,
      evaluate(text) {
        const html = /<html\b[^>]*>/i.test(text);
        const svg = /<svg\b[^>]*>/i.test(text);
        return { state: html && svg ? 'returned' : 'unparsed', label: html && svg ? '格式通过' : '格式不符', detail: `HTML：${html ? '包含' : '未找到'}；SVG：${svg ? '包含' : '未找到'}。仅检查返回文本中的标签，不评价画面、骑行动作或动画质量。` };
      },
    },
  };
  global.MITTests = tests;
})(typeof globalThis !== 'undefined' ? globalThis : this);
