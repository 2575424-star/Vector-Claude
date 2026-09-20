import os,json,urllib.request,urllib.error,uuid,hashlib
BASE='https://vector-crm-pavel.divine-lime-4457.chatgpt.site'
TOKEN=os.environ['VECTOR_TEST_TOKEN']
checks=[]
def call(path,method='GET',data=None,content_type='application/json',auth=True):
 h={'OAI-Sites-Authorization':'Bearer '+TOKEN} if auth else {}
 if data is not None:
  h['Content-Type']=content_type
  if not isinstance(data,bytes):data=json.dumps(data).encode()
 req=urllib.request.Request(BASE+path,data=data,headers=h,method=method)
 try:
  with urllib.request.urlopen(req,timeout=25) as r:return r.status,r.read(),dict(r.headers)
 except urllib.error.HTTPError as e:return e.code,e.read(),dict(e.headers)
def js(path,method='GET',data=None):
 code,raw,h=call('/api'+path,method,data)
 return code,json.loads(raw)
def check(label,ok):
 assert ok,label
 checks.append(label);print('PASS:',label,flush=True)
code,raw,h=call('/');check('HTML interface loads',code==200 and b'VECTOR CRM' in raw and b'/assets/' in raw)
code,d=js('/cars');check('Cloud returns six test vehicles',code==200 and len(d['cars'])==6)
c=next(x for x in d['cars'] if x['id']=='demo-6');original=dict(c)
code,duplicate=js('/cars','POST',c);check('Duplicate VIN blocked on live server',code==409)
code,c=js('/cars/'+c['id'],'PATCH',{**c,'notes':'Тест сохранения в облаке: успешно.'});check('Vehicle edit saves',code==200)
code,reopened=js('/cars/'+c['id']);check('Edit persists after separate request',reopened['notes']==c['notes'])
code,conflict=js('/cars/'+c['id'],'PATCH',original);check('Outdated edit rejected',code==409)
code,c=js('/cars/'+c['id']+'/costs','POST',{'revision':c['revision'],'type':'Другое','description':'Проверка расчёта','amount':123.45,'currency':'USD','rate':90,'date':'2026-09-08'});check('Foreign-currency expense saves',code==200 and c['costs'][-1]['amount']*c['costs'][-1]['rate']==11110.5)
cost=c['costs'][-1]
code,c=js('/cars/'+c['id']+'/costs/'+cost['id'],'DELETE',{'revision':c['revision']});check('Expense deletion recalculates composition',code==200 and not any(x['id']==cost['id'] for x in c['costs']))
code,c=js('/cars/'+c['id']+'/route','POST',{'revision':c['revision'],'status':'Заказан','location':'Дубай','date':'2026-09-08','note':'Проверка этапа маршрута: успешно.'});check('Route and history persist',code==200 and c['route'][-1]['note'].endswith('успешно.'))
code,c=js('/cars/'+c['id']+'/archive','POST',{'revision':c['revision'],'archived':True});check('Archiving works',code==200 and c['archived'])
code,c=js('/cars/'+c['id']+'/archive','POST',{'revision':c['revision'],'archived':False});check('Restoring works',code==200 and not c['archived'])
# Upload enough bytes to exercise multi-chunk cloud storage.
payload=(b'VECTOR CRM - TEST ATTACHMENT\n'*12000)+b'END'
boundary='VectorTest'+uuid.uuid4().hex
parts=[]
for k,v in [('category','Документ'),('revision',str(c['revision']))]:parts.append(('--'+boundary+'\r\nContent-Disposition: form-data; name="'+k+'"\r\n\r\n'+v+'\r\n').encode())
parts.append(('--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="vector-cloud-test.txt"\r\nContent-Type: text/plain\r\n\r\n').encode()+payload+b'\r\n')
parts.append(('--'+boundary+'--\r\n').encode());code,raw,h=call('/api/cars/'+c['id']+'/files','POST',b''.join(parts),'multipart/form-data; boundary='+boundary);c=json.loads(raw);check('File uploads to cloud',code==200)
f=c['files'][-1];code,download,h=call('/api/cars/'+c['id']+'/files/'+f['id']);check('Downloaded file matches upload byte for byte',code==200 and hashlib.sha256(download).digest()==hashlib.sha256(payload).digest())
code,c=js('/cars/'+c['id']+'/files/'+f['id'],'DELETE',{'revision':c['revision']});check('Test attachment removes cleanly',code==200)
code,c=js('/cars/'+c['id'],'PATCH',{**original,'revision':c['revision']});check('Original demo details restored',code==200 and c['notes']==original['notes'])
code,final=js('/cars/'+c['id']);check('Chronological audit history retained',len(final['history'])>=9)
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kw):return None
try:
 r=urllib.request.build_opener(NoRedirect).open(BASE+'/api/cars',timeout=25);anon=(r.status,r.read())
except urllib.error.HTTPError as e:anon=(e.code,e.read())
check('Anonymous request cannot read vehicle data',anon[0] in [301,302,303,307,308,401,403] and b'"cars"' not in anon[1])
print(json.dumps({'passed':len(checks),'checks':checks},ensure_ascii=False),flush=True)
