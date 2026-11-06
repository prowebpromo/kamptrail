/* User-initiated app installation; browsers own availability and confirmation. */
(function () {
  'use strict';
  const t = key => window.KampTrailI18n?.t(key) ?? key;
  const display = window.matchMedia('(display-mode: standalone)');
  let deferred = null, busy = false, installed = navigator.standalone === true || display.matches;
  let dialog, body, action, message, previousFocus, opening = false;
  const el = (tag, text, attrs={}) => {const n=document.createElement(tag);if(text)n.textContent=t(text);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;};
  function platform() {
    const ua=navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua) || (/Mac/.test(navigator.platform) && navigator.maxTouchPoints>1)) return 'ios';
    if (/Android/.test(ua)) return 'android';
    if (/Mac/.test(navigator.platform) && /Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua)) return 'mac';
    return 'desktop';
  }
  const instructions = {
    ios:'In Safari, open Share (or the page menu, then Share). Choose Add to Home Screen and tap Add. Look under View More if needed. Leave Open as Web App on if offered. If these options are missing in your browser, open this page in Safari.',
    android:'In Chrome, open the three-dot menu, then Install and create shortcut, then Install. Some versions show Add to Home screen or Install app. Follow the prompts.',
    mac:'In Safari on macOS 14 or later, choose File, then Add to Dock. Chrome and Edge also offer installation.',
    desktop:'In Chrome, use the address-bar Install icon, or the menu: Cast, save, and share, then Install page as app. In Edge: More tools, Apps, then Install this site as an app. If unavailable, bookmark KampTrail.'
  };
  function render() {
    const trigger=document.getElementById('install-kamptrail');
    const runningAsApp=display.matches || navigator.standalone===true;
    installed=installed || runningAsApp || window.KampTrailBeta?.status().installed===true;
    if(trigger){
      trigger.hidden=installed || window.KampTrailBeta?.installAvailable()!==true;
      const label=runningAsApp?'KampTrail app':installed?'KampTrail installed':'Install KampTrail';
      trigger.setAttribute('data-i18n',label);
      trigger.textContent=t(label);
    }
    if(!dialog)return;
    body.textContent=t(runningAsApp?'KampTrail is open as an app.':installed?'KampTrail is installed. Open it from your home screen, Dock or app launcher.':instructions[platform()]);
    action.hidden=installed || !deferred;action.disabled=busy;
    message.textContent=t(runningAsApp?'':installed?'Installation complete.':busy?'Finish the installation in your browser.':'');
  }
  async function install() {
    if(!deferred || busy || installed)return;
    const prompt=deferred;deferred=null;busy=true;render();
    try {
      await prompt.prompt();
      const choice=await prompt.userChoice;
      if(!installed)message.textContent=t(choice.outcome==='accepted'?'Your browser accepted the request. Finish any remaining installation steps.':'Installation dismissed. You can use the browser instructions above.');
    } catch {if(!installed)message.textContent=t('Installation is unavailable right now. Use the browser instructions above.');}
    finally {busy=false;action.disabled=false;action.hidden=installed || !deferred;}
  }
  async function open() {
    if (opening) return;
    opening = true;
    try {
      if (!window.KampTrailSafety || await window.KampTrailSafety.request() !== true) return;
    } catch { return; }
    finally { opening = false; }
    previousFocus=document.activeElement;
    if(!dialog){
      dialog=el('dialog',null,{id:'kt-install','aria-labelledby':'kt-install-title'});
      const head=el('div',null,{class:'kt-report-head'}),close=el('button','Close',{type:'button',class:'btn','aria-label':t('Close installation instructions')});
      close.onclick=()=>dialog.close();head.append(el('h2','Install KampTrail',{id:'kt-install-title'}),close);
      body=el('p');action=el('button','Install now',{type:'button',class:'btn primary'});action.onclick=install;
      message=el('p',null,{role:'status','aria-live':'polite'});
      const other=el('details'),summary=el('summary','Instructions for other devices');other.append(summary);for(const key of ['ios','android','mac','desktop'])other.append(el('p',instructions[key]));
      dialog.append(head,el('p','Add KampTrail to your home screen or app launcher for easy access. Free, with no account required.'),body,action,message,el('p',"Installation does not download maps. While online, use Offline to save Topo maps and save your stops. New routes, fresh weather and sending feedback need a connection.",{class:'kt-install-note'}),other);
      dialog.addEventListener('close',()=>previousFocus?.focus?.());document.body.append(dialog);
    }
    render();if(!dialog.open)dialog.showModal();
  }
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();if(!installed)deferred=event;render();});
  window.addEventListener('appinstalled',()=>{installed=true;deferred=null;busy=false;render();});
  window.addEventListener('kamptrail:installavailability',render);
  display.addEventListener?.('change',()=>render());
  document.getElementById('install-kamptrail')?.addEventListener('click',open);
  document.querySelectorAll?.('[data-install-open]').forEach(button=>button.addEventListener('click',open));
  render();
  window.KampTrailInstall={version:'2.46.5',open};
})();
