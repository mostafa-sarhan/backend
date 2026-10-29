import multer from "multer";
import { NextFunction, Request, Response } from "express";
import { AppError } from "../../lib/errors";
import { config } from "../../config";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
// Some browsers/OSes send xlsx as a generic binary type.
const ACCEPTED_MIME = new Set([XLSX_MIME, "application/octet-stream"]);
const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // xlsx files are zip archives

const invalidFile = (message: string) => new AppError(400, "INVALID_FILE", message);

const parser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.import.maxBytes, files: 1, fields: 0, parts: 2 },
  fileFilter: (_req, file, cb) => {
    if (!/\.xlsx$/i.test(file.originalname)) return cb(invalidFile("Only .xlsx files are accepted"));
    if (!ACCEPTED_MIME.has(file.mimetype)) return cb(invalidFile("Only .xlsx files are accepted"));
    cb(null, true);
  },
}).single("file");

// One .xlsx file in the `file` field: size, extension, MIME type and zip signature are checked.
export function xlsxUpload(req: Request, res: Response, next: NextFunction) {
  parser(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") return next(new AppError(413, "PAYLOAD_TOO_LARGE", `File larger than ${config.import.maxBytes} bytes`));
      return next(invalidFile("Upload one .xlsx file in the 'file' field"));
    }
    if (err) return next(err);
    if (!req.file) return next(invalidFile("Upload one .xlsx file in the 'file' field"));
    if (!req.file.buffer.subarray(0, 4).equals(ZIP_SIGNATURE)) return next(invalidFile("The file is not a valid .xlsx file"));
    next();
  });
}
