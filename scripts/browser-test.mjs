import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initStore } from '../src/storage.js';
import { startDashboard } from '../src/dashboard.js';

const root=await mkdtemp(join(tmpdir(),'intake-browser-'));
let browser, dashboard;
try {
 await initStore(root);
 dashboard=await startDashboard(root,{port:0,token:'browser-regression-original-token'});
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage();
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(dashboard.url);
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'Rotate token',exact:true}).click();
 await page.waitForFunction(()=>sessionStorage.getItem('intakeToken') && sessionStorage.getItem('intakeToken')!=='browser-regression-original-token');
 assert.equal(new URL(page.url()).searchParams.has('token'),false);
 const token=await page.evaluate(()=>sessionStorage.getItem('intakeToken'));
 const base=new URL(dashboard.url).origin;
 assert.equal((await fetch(`${base}/api/settings`,{headers:{'x-intake-token':'browser-regression-original-token'}})).status,401);
 assert.equal((await fetch(`${base}/api/settings`,{headers:{'x-intake-token':token}})).status,200);
 await page.getByRole('button',{name:'Save settings',exact:true}).click();
 await page.reload();
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'Rotate token',exact:true}).waitFor();
 assert.deepEqual(errors,[]);
 console.log('PASS Chromium: token rotation, revoked old token, authenticated save, reload, URL scrub, no page errors');
}finally{
 await browser?.close();
 if(dashboard)await new Promise(resolve=>dashboard.server.close(resolve));
 await rm(root,{recursive:true,force:true});
}
