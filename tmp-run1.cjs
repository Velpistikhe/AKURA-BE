const { patch } = require('./tmp-patch.cjs');
patch('marketing-service/src/modules/quotations/quotation.controller.ts', c => c
  .replace(', createQuotationFromWorkOrderSchema', '')
  .replace(/  async createFromWorkOrder\(req: Request, res: Response\) \{[\s\S]*?\n  \},\n/, '')
  .replace(', loadContractWorkOrder', ''));
