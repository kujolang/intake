import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {initStore,saveSources,saveItem} from '../src/storage.js';
import {makeSource} from '../src/models.js';import {createManualItem} from '../src/adapters/manual.js';import {startDashboard} from '../src/dashboard.js';
const root=await mkdtemp(join(tmpdir(),'intake-design-'));let browser,dashboard;
try{
 await initStore(root);const source=makeSource('manual',{id:'studio',name:'Studio inbox'});await saveSources(root,[source]);
 for(let i=0;i<5;i++)await saveItem(root,await createManualItem(root,source,{title:['A better way to manage our enquiries','Website project — next steps','October account update','New request from the team','Welcome to your workspace'][i],body:'Hello,\n\nWe would like to bring our customer enquiries into one place and make it easier for the team to follow up. Could we arrange a short conversation this week?\n\nThanks,\nAlex',queue:i%2?'sales':'support'}));
 dashboard=await startDashboard(root,{port:0,token:'design-test-token'});browser=await chromium.launch({headless:true,...(process.env.INTAKE_TEST_CHROME?{channel:'chrome'}:{})});const p=await browser.newPage({viewport:{width:1536,height:1000}});p.setDefaultTimeout(10000);const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(dashboard.url);await p.locator('#draftBody').waitFor();
 assert.equal(await p.locator('#queueDisclosure').evaluate(e=>e.open),false);await p.locator('#queueDisclosure summary').click();assert.equal(await p.locator('#queueDisclosure').evaluate(e=>e.open),true);await p.locator('#queueDisclosure summary').click();
 assert.equal(await p.evaluate(()=>CSS.supports('appearance','base-select')),true);
 await p.screenshot({path:'/tmp/intake-design-desktop.png'});
 await p.locator('#sourceFilter').click();await p.screenshot({path:'/tmp/intake-design-picker.png'});await p.keyboard.press('Escape');
 await p.getByRole('button',{name:'Sources',exact:true}).click();assert.equal(await p.locator('.sidepanel').isVisible(),false);await p.getByRole('button',{name:'Settings',exact:true}).click();assert.equal(await p.locator('.sidepanel').isVisible(),false);
 await p.getByRole('button',{name:'Inbox',exact:true}).first().click();await p.locator('#queues').getByRole('button',{name:/^Done 0$/}).click();await p.getByRole('heading',{name:'Inbox overview'}).waitFor();assert.equal(await p.getByRole('button',{name:'Manage sources',exact:true}).isVisible(),true);
 await p.setViewportSize({width:390,height:844});await p.screenshot({path:'/tmp/intake-design-mobile.png'});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.getByRole('button',{name:'Inbox views',exact:true}).click();await p.locator('#queueDisclosure summary').click();assert.equal(await p.locator('#queueDisclosure').evaluate(e=>e.open),true);assert.deepEqual(errors,[]);console.log('PASS: themed picker support, queue disclosure, contextual workspace, empty overview and mobile width.');
}finally{await browser?.close();if(dashboard)await new Promise(r=>dashboard.server.close(r));await rm(root,{recursive:true,force:true});}
