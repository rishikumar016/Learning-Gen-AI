import multer from "multer";

// Store file in memory and validate upload constraints.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      cb(new Error("Only PDF files are allowed"), false);
      return;
    }

    cb(null, true);
  },
});

export default upload;
