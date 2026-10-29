import {Minus,Square,X} from 'lucide-react';
export function WindowChrome(){
  const desktop=window.clearDesktop;
  if(!desktop)return null;
  return <header className="window-chrome"><div className="window-drag-area"><span>CLEAR</span><span>音乐，自在流动。</span></div><div className="window-controls"><button aria-label="最小化窗口" title="最小化" onClick={desktop.minimize}><Minus size={14}/></button><button aria-label="最大化或还原窗口" title="最大化 / 还原" onClick={desktop.maximize}><Square size={11}/></button><button aria-label="关闭到托盘" title="收进托盘，音乐继续播放" onClick={desktop.close}><X size={16}/></button></div></header>;
}
