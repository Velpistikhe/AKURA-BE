const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const uuid = {type:'string',format:'uuid'};
const version = {type:'integer',minimum:0,maximum:2147483646};
const text = {type:'string'};
const date = {type:'string',format:'date'};
const money = {type:'string',format:'decimal'};
const object = (properties: Record<string,unknown>, required: string[] = []) => ({type:'object',additionalProperties:false,properties,required});
const envelope = (data: object) => object({status:{type:'integer'},success:{type:'boolean'},message:text,data,requestId:text},['status','success','message','data']);
const paging = object({page:{type:'integer'},limit:{type:'integer'},total:{type:'integer'},totalPages:{type:'integer'}},['page','limit','total','totalPages']);
const security = [{bearerAuth:[]},{accessTokenCookie:[]}];
export const operationalSchemas: Record<string,object> = {};
export const operationalPaths: Record<string,object> = {};
for (const [prefix,module,name,kind,finance] of [
  ['finance','proforma-invoices','ProformaInvoice','PROFORMA_INVOICE',true],
  ['finance','invoices','Invoice','INVOICE',true],
  ['fieldservice','reports','FieldReport','REPORT',false],
] as const) {
  const fields = {number:{...text,minLength:1,maxLength:100,description:'User-assigned document number, normalized to uppercase. Unique per branch and document kind, including deleted records.'},title:{...text,minLength:1,maxLength:255},date,
    ...(finance ? {dueDate:{...date,nullable:true}} : {content:{...text,minLength:1,maxLength:100000}}),
    notes:{...text,maxLength:20000,nullable:true},status:{type:'string',enum:['DRAFT','FINAL'],default:'DRAFT'}};
  const required=['number','title','date',...(!finance?['content']:[])];
  operationalSchemas[name+'Create']=object({...fields,quotationId:uuid,quotationVersion:version},[...required,'quotationId','quotationVersion']);
  operationalSchemas[name+'Update']={...object({...fields,version,reason:{...text,minLength:1,maxLength:1000}},['version']),minProperties:2,description:'At least one editable field is required. quotationId, quotationVersion, snapshots, amounts and branch cannot be changed. Due date cannot precede document date.'};
  operationalSchemas[name+'Delete']=object({version,reason:{...text,minLength:1,maxLength:1000}},['version']);
  operationalSchemas[name]=object({...fields,id:uuid,kind:{type:'string',enum:[kind]},officeBranchId:{...uuid,readOnly:true},quotationId:uuid,quotationVersion:version,
    quotationSnapshot:{type:'object',additionalProperties:true,readOnly:true,description:'Full quotation and item snapshot validated through Marketing when the document was created. Preserved on later edits and source quotation changes.'},
    ...(finance?{subTotal:money,tax:{...money,nullable:true,readOnly:true},taxSourceId:{...uuid,nullable:true,readOnly:true},taxAmount:money,total:money}:{}),version,isActive:{type:'boolean'},createdById:uuid,createdByName:text,updatedById:{...uuid,nullable:true},updatedByName:{...text,nullable:true},createdAt:{type:'string',format:'date-time'},updatedAt:{type:'string',format:'date-time'}},['id','kind','officeBranchId','quotationId','quotationVersion','quotationSnapshot',...required,'version','isActive']);
  operationalSchemas[name+'Response']=envelope(ref(name));
  operationalSchemas[name+'List']=envelope(object({documents:{type:'array',items:ref(name)},pagination:paging},['documents','pagination']));
  operationalSchemas[name+'History']=envelope(object({history:{type:'array',items:object({id:uuid,documentId:uuid,version,action:{type:'string',enum:['CREATE','UPDATE','DEACTIVATE']},actionLabel:text,reason:{...text,nullable:true},changedBy:object({id:uuid,name:text},['id','name']),changedAt:{type:'string',format:'date-time'},snapshot:ref(name),changes:{type:'array',items:object({field:text,label:text,before:{nullable:true},after:{nullable:true}},['field','label','before','after'])}},['id','version','action','actionLabel','changedBy','changedAt','snapshot','changes'])},pagination:paging},['history','pagination']));
  const query = (name:string,schema:object) => ({name,in:'query',schema});
  const pagination=[query('page',{type:'integer',minimum:1,maximum:1000000,default:1}),query('limit',{type:'integer',minimum:1,maximum:100,default:20})];
  const id={name:'id',in:'path',required:true,schema:uuid};
  const operation = (summary:string,schema:string,parameters:object[]=[],body?:string,status=200) => ({summary,tags:[name],security,parameters,
    description:'Requires an active authenticated user with an office branch. All operations and quotation references are scoped to that branch. No branch or actor fields are accepted from clients. Updates and soft deletes use optimistic version checks and append history atomically. Quotation is fetched through Gateway (no cross-database foreign key); source changes after validation do not update the saved snapshot. '+(finance?'Subtotal comes from the validated quotation. Finance selects master tax effective on the document date and recalculates taxAmount (half-up, two decimals) and total, saving tax and taxSourceId. Draft date changes and finalization revalidate tax. Final documents cannot be edited. Legacy documents may have null tax and taxSourceId; partial billing, payment recording and accounting posting are outside this CRUD module.':'Report content is plain text; attachment upload is outside this CRUD module.'),
    ...(body?{requestBody:{required:true,content:{'application/json':{schema:ref(body)}}}}:{}),responses:{[status]:{description:'Success',content:{'application/json':{schema:ref(schema)}}},400:{description:'Invalid request'},401:{description:'Unauthenticated'},403:{description:'Inactive user or no office branch'},404:{description:'Document or quotation not found in this branch'},409:{description:'Stale version, inactive/final document, duplicate number, or missing applicable Finance tax'},502:{description:'Invalid upstream response'},503:{description:'Referenced service unavailable'}}});
  const root=`/api/v1/${prefix}/${module}`;
  operationalPaths[root]={get:operation('List '+module,name+'List',[...pagination,query('quotationId',uuid),query('status',{type:'string',enum:['DRAFT','FINAL']}),query('search',{...text,maxLength:100})]),post:operation('Create '+name,name+'Response',[],name+'Create',201)};
  operationalPaths[root+'/{id}']={get:operation('Get '+name,name+'Response',[id]),patch:operation('Update '+name,name+'Response',[id],name+'Update'),delete:operation('Soft delete '+name,name+'Response',[id],name+'Delete')};
  operationalPaths[root+'/{id}/history']={get:operation('Read '+name+' history, including deleted documents',name+'History',[id,...pagination])};
}

operationalPaths['/api/v1/marketing/quotation-references/{quotationId}'] = { get: {
  tags:['Quotations'], summary:'Read a quotation reference for Finance or Field Service',security,
  description:'Read-only active quotation within the current user branch. Allowed sections: MARKETING, FINANCE, ACCOUNTING, FIELD_SERVICE; ADMIN and APP_MANAGER also allowed. Does not grant access to Marketing mutations.',
  parameters:[{name:'quotationId',in:'path',required:true,schema:uuid}],
  responses:{200:{description:'Quotation snapshot',content:{'application/json':{schema:envelope(ref('Quotation'))}}},401:{description:'Invalid token or stale branch assignment'},403:{description:'Section access denied'},404:{description:'Quotation not found in current branch'}}
} };
