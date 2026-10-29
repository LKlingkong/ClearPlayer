import { Check, X, Sparkles } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { Theme } from '../types';
import { IconButton } from './IconButton';
export const themes: {id: Theme; name: string; description: string; mood: string}[] = [
  {id:'glass', name:'雾蓝玻璃', description:'柔和光晕，沉入夜色', mood:'NIGHTFALL'},
  {id:'light', name:'浅色唱片室', description:'明亮留白，轻盈日常', mood:'DAYLIGHT'},
  {id:'stage', name:'极简舞台', description:'让歌词，成为主角', mood:'SPOTLIGHT'},
];
export function ThemePicker({theme, onChange, onClose}: {theme: Theme; onChange: (theme: Theme) => void; onClose: () => void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="theme-dialog" onCancel={onClose} onClick={e => {if(e.target === e.currentTarget) onClose();}}>
    <div className="dialog-heading"><div><span className="eyebrow"><Sparkles size={13}/> MAKE IT YOURS</span><h2>为音乐，换一种氛围。</h2><p>选择喜欢的空间，声音会继续流动。</p></div><IconButton label="关闭外观设置" onClick={onClose}><X size={20}/></IconButton></div>
    <div className="theme-options">{themes.map(item => <button key={item.id} className={`theme-option ${theme === item.id ? 'selected' : ''}`} onClick={() => onChange(item.id)} aria-pressed={theme === item.id}>
      <div className={`theme-preview preview-${item.id}`}><div className="preview-sidebar"><i/><i/><i/></div><div className="preview-main"><div className="preview-picture"/><div className="preview-lines"><i/><i/><i/><i/></div><div className="preview-player"/></div><span>{item.mood}</span></div>
      <div className="theme-option-label"><strong>{item.name}</strong>{theme === item.id && <Check size={16}/>}</div><p>{item.description}</p>
    </button>)}</div><div className="dialog-footer"><span><span className="status-dot"/>外观会自动保存在此设备</span><button className="primary-button" onClick={onClose}>就用这个</button></div>
  </dialog>;
}
