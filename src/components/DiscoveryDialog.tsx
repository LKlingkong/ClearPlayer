import {useEffect,useRef} from 'react';
import type {ReactNode} from 'react';
import {X} from 'lucide-react';
export function DiscoveryDialog({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){
 const ref=useRef<HTMLDialogElement>(null),close=useRef(onClose);close.current=onClose;
 useEffect(()=>{const dialog=ref.current,previous=document.activeElement as HTMLElement|null;if(!dialog)return;
  dialog.showModal();(dialog.querySelector('[data-autofocus]') as HTMLElement|null)?.focus();
  return()=>{dialog.close();previous?.focus?.();};
 },[]);
 return <dialog ref={ref} className="discovery-dialog" aria-label={title} onCancel={e=>{e.preventDefault();close.current();}} onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close.current();}}}>
  <div className="discovery-dialog-inner"><header><h2>{title}</h2><button className="icon-button" aria-label="关闭对话框" onClick={onClose}><X size={19}/></button></header>{children}</div>
 </dialog>;
}
