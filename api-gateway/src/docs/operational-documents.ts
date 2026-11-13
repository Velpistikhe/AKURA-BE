const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const uuid = {type:'string',format:'uuid'};
const text = {type:'string'};
const object = (properties: Record<string,unknown>, required: string[] = []) => ({type:'object',additionalProperties:false,properties,required});
const envelope = (data: object) => object({status:{type:'integer'},success:{type:'boolean'},message:text,data,requestId:text},['status','success','message','data']);
const security = [{bearerAuth:[]},{accessTokenCookie:[]}];
export const operationalSchemas: Record<string,object> = {};
export const operationalPaths: Record<string,object> = {};

operationalPaths['/api/v1/marketing/quotation-references/{quotationId}'] = { get: {
  tags:['Quotations'], summary:'Read a quotation reference for Finance or Field Service',security,
  description:'Read-only active quotation within the current user branch, used by Field Service as the live document basis of a Work Order. Allowed sections: MARKETING, FINANCE, ACCOUNTING, FIELD_SERVICE; ADMIN and APP_MANAGER also allowed. Does not grant access to Marketing mutations.',
  parameters:[{name:'quotationId',in:'path',required:true,schema:uuid}],
  responses:{400:{description:'Invalid quotation ID'},200:{description:'Quotation snapshot',content:{'application/json':{schema:envelope(ref('Quotation'))}}},401:{description:'Invalid token or stale branch assignment'},403:{description:'Section access denied'},404:{description:'Quotation not found in current branch'}}
} };

operationalSchemas['ItemSizeReference']=object({
  itemSizeId:uuid,
  serviceName:{...text,description:'Name of the service owning the item, or the item name for a standalone item.'},
  inspectionScope:{...text,description:'Active inspection scopes of the size, joined with a comma and one space.'},
  maintenanceScope:{...text,description:'Active maintenance scopes of the size, joined with a comma and one space.'},
  itemName:{...text,description:'Item name of the catalog.'},
  size:{...text,nullable:true,description:'Size variant, null for an item without a size.'},
},['itemSizeId','serviceName','inspectionScope','maintenanceScope','itemName','size']);

operationalPaths['/api/v1/marketing/item-size-references/{itemSizeId}'] = { get: {
  tags:['Quotations'], summary:'Read an item size reference for Field Service',security,
  description:'Read-only catalog identity of one item size within the current user branch, including its active inspection and maintenance scopes. Allowed sections: MARKETING, FINANCE, ACCOUNTING, FIELD_SERVICE; ADMIN and APP_MANAGER also allowed. Field Service uses it to snapshot a Work Order item when the document basis carries no quotation line.',
  parameters:[{name:'itemSizeId',in:'path',required:true,schema:uuid}],
  responses:{400:{description:'Invalid item size ID'},200:{description:'Item size reference',content:{'application/json':{schema:envelope(ref('ItemSizeReference'))}}},401:{description:'Invalid token or stale branch assignment'},403:{description:'Section access denied'},404:{description:'Item size not found in current branch'},409:{description:'Item size, item or service is inactive'}}
} };

