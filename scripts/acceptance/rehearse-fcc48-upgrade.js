'use strict';
const {readFileSync}=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium,expect}=require('@playwright/test');
const {move,renderedStatus,onlineUpgrade,select,saved,observe,launch,expected}=require('./verify-fcc48-browser');
const old=JSON.parse(readFileSync(path.resolve(process.env.QA_PROFILES,'baseline.json'),'utf8'));
const rows=JSON.parse(readFileSync(process.argv[2],'utf8')).archiveChecks;
(async()=>{
  for(const mode of ['desktop','mobile']){
    const mobile=mode==='mobile';
    const context=await chromium.launchPersistentContext(path.resolve(process.env.QA_PROFILES,mode),
      {...launch,viewport:mobile?{width:390,height:844}:{width:1440,height:960},isMobile:mobile,hasTouch:mobile});
    try{
      const obs=observe(context), page=context.pages()[0]||await context.newPage();
      await context.setOffline(true);
      await page.goto(process.env.BASE,{waitUntil:'domcontentloaded'});
      assert.deepEqual(await saved(page),old[mode].storedIds);
      await onlineUpgrade(page,context);
      for(const row of rows){
        await select(page,row.carrier);
        for(const [kind,p] of Object.entries(row.witnesses)){
          await move(page,p);
          await expect(page.locator('#fcc-coverage-readout [role=status]')).toHaveText(expected[kind],{timeout:30000});
          if(kind!=='missing') await expect.poll(()=>renderedStatus(page,p),{timeout:30000}).toBe(kind);
        }
      }
      assert.ok(obs.responses.length); assert.deepEqual(obs.png,[]); assert.deepEqual(obs.errors,[]);
      const p=rows.find(r=>r.carrier==='att').witnesses.covered;
      await move(page,p);await select(page,'att');await expect(page.locator('#fcc-coverage-readout [role=status]')).toHaveText(expected.covered,{timeout:30000});
      await context.setOffline(true);
      await page.reload({waitUntil:'domcontentloaded'});await page.locator('.kt-coverage-picker select').waitFor({state:'attached'});
      await move(page,p);await select(page,'att');await expect(page.locator('#fcc-coverage-readout [role=status]')).toHaveText(expected.covered,{timeout:30000});
      await expect(page.locator('#fcc-coverage-readout')).toContainText('Offline copy, not current.');
      assert.deepEqual(await saved(page),old[mode].storedIds);
      console.log('Rhode Island rehearsal passed',mode,obs.responses.length,'real range responses');
    }finally{await context.close();}
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
