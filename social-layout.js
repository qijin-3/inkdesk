// Canvas is both the preview and export surface: no screenshot/layout mismatch.
export async function socialPages(html, title, size = 30) {
  await document.fonts.ready;
  const root = new DOMParser().parseFromString(html, 'text/html').body;
  const pages = []; let ctx, y;
  const W=1200, H=1600, pad=100, bottom=H-pad;
  function page() {
    if (pages.length >= 17) throw Error('内容超过 17 张，请缩小字号或精简正文后重试。未导出截断内容。');
    const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
    ctx=canvas.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,W,H);
    ctx.textBaseline='top'; y=pad; pages.push(canvas);
  }
  function font(n,bold) {ctx.font=`${bold?800:400} ${n}px "PingFang SC", sans-serif`;}
  function text(runs,n,heading=false) {
    const line=n*1.55; let x=pad;
    if(y+line>bottom) page();
    for(const run of runs) for(const ch of Array.from(run.text)) {
      font(n,heading||run.bold); const width=ctx.measureText(ch).width;
      if(ch==='\n'||x+width>W-pad) {x=pad;y+=line;if(y+line>bottom)page();font(n,heading||run.bold);}
      if(ch==='\n')continue;
      ctx.fillStyle=!heading&&run.bold?'#1647ff':'#111';ctx.fillText(ch,x,y);x+=width;
    }
    y+=line+(heading?26:22);
  }
  async function picture(src) {
    const img=new Image();
    if(/^https?:/.test(src))img.crossOrigin='anonymous';
    img.src=src;
    await Promise.race([img.decode(),new Promise((_,r)=>setTimeout(()=>r(Error('图片加载超时')),12000))]);
    const scale=Math.min((W-pad*2)/img.naturalWidth,620/img.naturalHeight);
    const w=img.naturalWidth*scale,h=img.naturalHeight*scale;
    if(y+h>bottom)page();ctx.drawImage(img,(W-w)/2,y,w,h);y+=h+26;
  }
  async function block(node) {
    if(node.nodeName==='IMG'){await picture(node.getAttribute('src'));return;}
    if(node.nodeName==='HR'){if(y!==pad)page();return;}
    if(node.querySelector?.('img')){for(const child of node.childNodes)await block(child);return;}
    if(['UL','OL','BLOCKQUOTE','TABLE','TBODY','THEAD'].includes(node.nodeName)){for(const child of node.children)await block(child);return;}
    const runs=[];
    function collect(n,bold=false){if(n.nodeType===3)runs.push({text:n.textContent,bold});else if(n.nodeName==='BR')runs.push({text:'\n',bold});else for(const c of n.childNodes)collect(c,bold||['STRONG','B'].includes(n.nodeName));}
    collect(node);if(!runs.some(r=>r.text.trim()))return;
    if(node.nodeName==='LI')runs.unshift({text:'• ',bold:false});
    text(runs,/^H[1-6]$/.test(node.nodeName)?size*1.8:size,/^H[1-6]$/.test(node.nodeName));
  }
  page(); if(title)text([{text:title}],size*2,true);
  for(const node of root.childNodes)await block(node);
  // Validate images are exportable before showing a successful preview.
  for(const c of pages)c.toDataURL('image/png');
  return pages;
}

/**
 * 在右侧栏容器内渲染小红书分页预览，并绑定字号切换与导出图片。
 * @param {ParentNode} root 含 #social-pages / #social-size / #social-export / #social-status 的根节点
 * @param {{html:string,title:string,api:Function,web:boolean}} opts 排版内容与导出通道
 * @returns {{destroy:Function}} 离开预览时取消进行中的排版
 */
export function bindSocialPreview(root, { html, title, api, web }) {
  const q = (s) => root.querySelector(s);
  let pages = [];
  let generation = 0;

  /** 按当前字号重绘全部竖版页 */
  async function draw() {
    const g = ++generation;
    const exportBtn = q("#social-export");
    const status = q("#social-status");
    const list = q("#social-pages");
    exportBtn.disabled = true;
    status.textContent = "正在排版…";
    list.replaceChildren();
    try {
      const next = await socialPages(html, title, +q("#social-size").value);
      if (g !== generation) return;
      pages = next;
      for (const [i, c] of pages.entries()) {
        const figure = document.createElement("figure");
        const label = document.createElement("figcaption");
        label.textContent = `${i + 1} / ${pages.length}`;
        figure.append(c, label);
        list.append(figure);
      }
      status.textContent = `共 ${pages.length} 张`;
      exportBtn.disabled = false;
    } catch (e) {
      if (g === generation) status.textContent = "排版失败：" + e.message;
    }
  }

  q("#social-size").onchange = draw;
  q("#social-export").onclick = async () => {
    const b = q("#social-export");
    b.disabled = true;
    try {
      const images = pages.map((c) => c.toDataURL("image/png"));
      if (web) {
        for (const [i, url] of images.entries()) {
          const a = document.createElement("a");
          a.href = url;
          a.download = `${title.replace(/[\\/:*?"<>|]/g, "_")}-${String(i + 1).padStart(2, "0")}.png`;
          a.click();
        }
        q("#social-status").textContent = "已提交浏览器下载，请允许下载多个文件";
      } else {
        const result = await api("export-social", { title, images });
        q("#social-status").textContent = result
          ? `已导出 ${images.length} 张到 ${result}`
          : "已取消导出";
      }
    } catch (e) {
      q("#social-status").textContent = e.message;
    } finally {
      b.disabled = false;
    }
  };
  draw();
  return {
    destroy() {
      generation++;
    },
  };
}
