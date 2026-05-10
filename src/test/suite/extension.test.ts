import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { isPdfFile, isImageFile, escapeShellArg, validatePaths } from '../../extension';

suite('QubesOS Extension Test Suite', () => {
    
    suite('isPdfFile', () => {
        test('should return true for .pdf files', () => {
            assert.strictEqual(isPdfFile('/path/to/document.pdf'), true);
            assert.strictEqual(isPdfFile('document.pdf'), true);
            assert.strictEqual(isPdfFile('my.file.with.dots.pdf'), true);
        });

        test('should return true for .PDF files (case-insensitive)', () => {
            assert.strictEqual(isPdfFile('DOCUMENT.PDF'), true);
            assert.strictEqual(isPdfFile('Document.Pdf'), true);
            assert.strictEqual(isPdfFile('file.PdF'), true);
        });

        test('should return false for non-PDF files', () => {
            assert.strictEqual(isPdfFile('document.txt'), false);
            assert.strictEqual(isPdfFile('document.docx'), false);
            assert.strictEqual(isPdfFile('document.png'), false);
            assert.strictEqual(isPdfFile('document'), false);
            assert.strictEqual(isPdfFile('pdf'), false);
        });

        test('should handle edge cases', () => {
            assert.strictEqual(isPdfFile(''), false);
            assert.strictEqual(isPdfFile('.pdf'), true);
            assert.strictEqual(isPdfFile('file.pdf.bak'), false);
        });
    });

    suite('isImageFile', () => {
        test('should return true for common image extensions', () => {
            assert.strictEqual(isImageFile('photo.png'), true);
            assert.strictEqual(isImageFile('photo.jpg'), true);
            assert.strictEqual(isImageFile('photo.jpeg'), true);
            assert.strictEqual(isImageFile('photo.gif'), true);
            assert.strictEqual(isImageFile('photo.bmp'), true);
            assert.strictEqual(isImageFile('photo.webp'), true);
            assert.strictEqual(isImageFile('photo.svg'), true);
        });

        test('should return true for TIFF variants', () => {
            assert.strictEqual(isImageFile('photo.tiff'), true);
            assert.strictEqual(isImageFile('photo.tif'), true);
        });

        test('should be case-insensitive', () => {
            assert.strictEqual(isImageFile('PHOTO.PNG'), true);
            assert.strictEqual(isImageFile('Photo.Jpg'), true);
            assert.strictEqual(isImageFile('image.JPEG'), true);
        });

        test('should return false for non-image files', () => {
            assert.strictEqual(isImageFile('document.pdf'), false);
            assert.strictEqual(isImageFile('document.txt'), false);
            assert.strictEqual(isImageFile('document.mp4'), false);
            assert.strictEqual(isImageFile('document'), false);
        });

        test('should handle edge cases', () => {
            assert.strictEqual(isImageFile(''), false);
            assert.strictEqual(isImageFile('.png'), true);
            assert.strictEqual(isImageFile('file.png.bak'), false);
        });
    });

    suite('escapeShellArg', () => {
        test('should wrap simple strings in single quotes', () => {
            assert.strictEqual(escapeShellArg('simple'), "'simple'");
            assert.strictEqual(escapeShellArg('file.txt'), "'file.txt'");
        });

        test('should escape single quotes correctly', () => {
            // Single quotes should be escaped as '\''
            assert.strictEqual(escapeShellArg("it's"), "'it'\\''s'");
            assert.strictEqual(escapeShellArg("user's file"), "'user'\\''s file'");
        });

        test('should handle multiple single quotes', () => {
            assert.strictEqual(escapeShellArg("it's Joe's file"), "'it'\\''s Joe'\\''s file'");
        });

        test('should protect against command injection', () => {
            // These should be safely escaped
            assert.strictEqual(escapeShellArg('file; rm -rf /'), "'file; rm -rf /'");
            assert.strictEqual(escapeShellArg('file`whoami`'), "'file`whoami`'");
            assert.strictEqual(escapeShellArg('file$(whoami)'), "'file$(whoami)'");
            assert.strictEqual(escapeShellArg('file|cat /etc/passwd'), "'file|cat /etc/passwd'");
        });

        test('should handle special characters', () => {
            assert.strictEqual(escapeShellArg('file with spaces'), "'file with spaces'");
            assert.strictEqual(escapeShellArg('file\twith\ttabs'), "'file\twith\ttabs'");
            assert.strictEqual(escapeShellArg('file\nwith\nnewlines'), "'file\nwith\nnewlines'");
            assert.strictEqual(escapeShellArg('file$var'), "'file$var'");
            assert.strictEqual(escapeShellArg('file&background'), "'file&background'");
        });

        test('should handle empty string', () => {
            assert.strictEqual(escapeShellArg(''), "''");
        });

        test('should handle unicode characters', () => {
            assert.strictEqual(escapeShellArg('файл.txt'), "'файл.txt'");
            assert.strictEqual(escapeShellArg('文件.txt'), "'文件.txt'");
            assert.strictEqual(escapeShellArg('🎉emoji.txt'), "'🎉emoji.txt'");
        });
    });

    suite('validatePaths', () => {
        let tempDir: string;
        let existingFile: string;
        let existingDir: string;

        setup(() => {
            // Create temporary test files/directories
            tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qubes-test-'));
            existingFile = path.join(tempDir, 'test-file.txt');
            existingDir = path.join(tempDir, 'test-dir');
            
            fs.writeFileSync(existingFile, 'test content');
            fs.mkdirSync(existingDir);
        });

        teardown(() => {
            // Clean up temporary files
            try {
                if (fs.existsSync(existingFile)) {
                    fs.unlinkSync(existingFile);
                }
                if (fs.existsSync(existingDir)) {
                    fs.rmdirSync(existingDir);
                }
                if (fs.existsSync(tempDir)) {
                    fs.rmdirSync(tempDir);
                }
            } catch (err) {
                console.error('Cleanup error:', err);
            }
        });

        test('should validate existing files', () => {
            const result = validatePaths([existingFile]);
            assert.strictEqual(result.valid.length, 1);
            assert.strictEqual(result.valid[0], existingFile);
            assert.strictEqual(result.invalid.length, 0);
        });

        test('should validate existing directories', () => {
            const result = validatePaths([existingDir]);
            assert.strictEqual(result.valid.length, 1);
            assert.strictEqual(result.valid[0], existingDir);
            assert.strictEqual(result.invalid.length, 0);
        });

        test('should detect non-existent paths', () => {
            const nonExistent = path.join(tempDir, 'does-not-exist.txt');
            const result = validatePaths([nonExistent]);
            assert.strictEqual(result.valid.length, 0);
            assert.strictEqual(result.invalid.length, 1);
            assert.strictEqual(result.invalid[0], nonExistent);
        });

        test('should handle mixed valid and invalid paths', () => {
            const nonExistent1 = path.join(tempDir, 'missing1.txt');
            const nonExistent2 = path.join(tempDir, 'missing2.txt');
            const result = validatePaths([existingFile, nonExistent1, existingDir, nonExistent2]);
            
            assert.strictEqual(result.valid.length, 2);
            assert.strictEqual(result.invalid.length, 2);
            assert.ok(result.valid.includes(existingFile));
            assert.ok(result.valid.includes(existingDir));
            assert.ok(result.invalid.includes(nonExistent1));
            assert.ok(result.invalid.includes(nonExistent2));
        });

        test('should handle empty array', () => {
            const result = validatePaths([]);
            assert.strictEqual(result.valid.length, 0);
            assert.strictEqual(result.invalid.length, 0);
        });

        test('should handle multiple valid paths', () => {
            const file2 = path.join(tempDir, 'test-file2.txt');
            fs.writeFileSync(file2, 'test content 2');
            
            try {
                const result = validatePaths([existingFile, file2, existingDir]);
                assert.strictEqual(result.valid.length, 3);
                assert.strictEqual(result.invalid.length, 0);
            } finally {
                fs.unlinkSync(file2);
            }
        });

        test('should handle all invalid paths', () => {
            const paths = [
                '/path/does/not/exist1',
                '/path/does/not/exist2',
                '/path/does/not/exist3'
            ];
            const result = validatePaths(paths);
            assert.strictEqual(result.valid.length, 0);
            assert.strictEqual(result.invalid.length, 3);
        });
    });
});
