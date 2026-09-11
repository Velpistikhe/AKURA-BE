import { Request, RequestHandler, Response } from 'express';
import multer from 'multer';
import { prisma } from '../../config/db.js';
import { getAuditActor, getOfficeBranchId } from '../../utils/officeBranch.js';
import { HttpError } from '../../utils/httpError.js';
import { itemService } from '../items/item.service.js';
import { contractExcelRepository } from './contract-excel.repository.js';
import { createPriceWorkbook, parsePriceWorkbook } from './contract-excel.workbook.js';
import { ExcelImportError, MAX_EXCEL_BYTES } from './contract-excel.schemas.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_EXCEL_BYTES, files: 1, fields: 2, parts: 4, fieldSize: 200 },
  fileFilter: (_req, file, callback) => {
    if (!file.originalname.toLowerCase().endsWith('.xlsx')) callback(new HttpError('Only .xlsx files are accepted', 400));
    else callback(null, true);
  },
}).single('file');
export const uploadContractWorkbook: RequestHandler = (req, res, next) => {
  if (!req.is('multipart/form-data')) { next(new HttpError('Use multipart/form-data with a file field', 400)); return; }
  upload(req, res, error => {
    if (error instanceof multer.MulterError) { next(new HttpError(error.code === 'LIMIT_FILE_SIZE' ? 'Excel file exceeds 5 MB' : 'Upload one file with companyId and version', error.code === 'LIMIT_FILE_SIZE' ? 413 : 400)); return; }
    next(error);
  });
};
export const contractExcelController = {
  download: async (_req: Request, res: Response) => {
    const branch = getOfficeBranchId(res);
    if (res.locals.query.companyId) {
      const company = await prisma.company.findFirst({
        where: { id: res.locals.query.companyId, officeBranchId: branch, revoked: false },
        select: { id: true },
      });
      if (!company) throw new HttpError('Company not found in the current branch', 404);
    }
    await itemService.validateSizeListItem({ ...res.locals.query, page: 1, limit: 1 }, branch);
    const rows = await contractExcelRepository.exportSizes(res.locals.query, branch);
    const buffer = await createPriceWorkbook(rows, branch);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="akura-normal-prices.xlsx"');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(buffer);
  },
  upload: async (req: Request, res: Response) => {
    try {
      const branch = getOfficeBranchId(res);
      if (!req.file) throw new HttpError('Excel file is required', 400);
      const rows = await parsePriceWorkbook(req.file.buffer, branch);
      const result = await contractExcelRepository.importPrices(res.locals.params.contractId, res.locals.body.companyId, res.locals.body.version, rows, branch, getAuditActor(res));
      res.status(201).json({ status: 201, success: true, data: result, requestId: req.headers['x-request-id'] });
    } catch (error) {
      if (!(error instanceof ExcelImportError)) throw error;
      res.status(error.statusCode).json({ status: error.statusCode, success: false, message: error.message, errors: error.errors, requestId: req.headers['x-request-id'] });
    }
  },
};
