const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const token='f'.repeat(32);
for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
  test.describe(`private feedback ${viewport.width}`,()=>{
    test.use({viewport,serviceWorkers:'block'});
    async function setup(page,context,path='/',down=false){
      const sent=[];
      await context.route(/^https:\/\//,r=>r.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64')}));
      await page.route('**/api/submit.php',r=>{sent.push(r.request().postDataJSON());return r.fulfill({status:down?503:201,contentType:'application/json',body:JSON.stringify(down?{ok:false,error:'unavailable'}:{ok:true,token,status:'received'})});});
      await page.route('**/api/status.php*',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,status:'accepted',note:'We are investigating.'})}));
      await page.goto(path,{waitUntil:'domcontentloaded'});
      return sent;
    }
    test('bug report is private by default, tracked, accessible and leaves the map usable',async({page,context})=>{
      const sent=await setup(page,context);
      await expect(page.locator('#map')).toBeVisible();
      const trigger=page.getByRole('button',{name:'Feedback',exact:true});await trigger.click();
      const d=page.getByRole('dialog',{name:'Help improve KampTrail'});
      await expect(d.getByLabel('Include basic app diagnostics (optional)')).not.toBeChecked();
      await d.getByLabel('Short summary').fill('Search closes after Enter');
      await d.getByLabel('What happened?').fill('Search closes after I type a town and press Enter.');
      expect((await new AxeBuilder({page}).include('#kt-feedback').analyze()).violations).toEqual([]);
      await d.getByRole('button',{name:'Send feedback'}).click();
      await expect(d).toContainText('Your feedback was received');
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({kind:'bug',title:'Search closes after Enter',contact_email:''});
      for(const key of ['lat','lng','campsite_id','diagnostics','firsthand'])expect(sent[0]).not.toHaveProperty(key);
      const link=d.getByRole('link',{name:'Private report status'});await expect(link).toHaveAttribute('href',new RegExp(`#feedback=report:${token}$`));
      await link.click();await expect(d).toContainText('Accepted for follow-up.');
      await d.getByRole('button',{name:'Close feedback'}).click();await expect(trigger).toBeFocused();
      await expect(page).not.toHaveURL(/#feedback=/);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await trigger.click();await d.getByRole('button',{name:'My reports',exact:true}).click();
      await expect(page.getByRole('dialog',{name:'My reports'})).toContainText('Accepted for follow-up.');
      await expect(page.getByRole('dialog',{name:'My reports'})).not.toContainText('The data will be updated');
    });
    test('feature deep link permits explicit coarse diagnostics and optional email',async({page,context})=>{
      const sent=await setup(page,context,'/#feedback=feature');
      const d=page.getByRole('dialog',{name:'Help improve KampTrail'});
      await expect(d.getByLabel('Feedback type')).toHaveValue('feature');
      await d.getByLabel('Short summary').fill('Improve offline preparation');
      await d.getByLabel('What would help you, and why?').fill('Show the saved area before travel so I can check my download.');
      await d.getByLabel('Email (optional)').fill('qa@example.test');
      await d.getByLabel('Include basic app diagnostics (optional)').check();
      await d.getByRole('button',{name:'Send feedback'}).click();await expect(d).toContainText('Your feedback was received');
      expect(sent[0]).toMatchObject({kind:'feature',contact_email:'qa@example.test',include_diagnostics:true,diagnostics:{language:'en',width:viewport.width,height:viewport.height,connection:'online'}});
      expect(Object.keys(sent[0].diagnostics).sort()).toEqual(['browser','connection','height','language','version','width']);
    });
    test('failure preserves text and exposes a verified contact fallback',async({page,context})=>{
      await setup(page,context,'/#feedback=bug',true);
      const d=page.getByRole('dialog',{name:'Help improve KampTrail'});
      await d.getByLabel('Short summary').fill('Unable to search');
      await d.getByLabel('What happened?').fill('Search does not return results after I type a town.');
      await d.getByRole('button',{name:'Send feedback'}).click();
      await expect(d).toContainText('Your text is still here');
      await expect(d.getByLabel('Short summary')).toHaveValue('Unable to search');
      await expect(d.getByRole('link',{name:'Contact KampTrail'})).toHaveAttribute('href','https://boondockorbust.com/contact/#contact-form');
      await expect(d.getByRole('button',{name:'Send feedback'})).toBeEnabled();
    });
    test('private link works without saved browser storage and renders moderator text literally',async({page,context})=>{
      await setup(page,context,`/#feedback=report:${token}`);
      const d=page.getByRole('dialog',{name:'Help improve KampTrail'});
      await expect(d).toContainText('Accepted for follow-up.');await expect(d).toContainText('We are investigating.');
    });
  });
}
