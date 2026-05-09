import * as vscode from 'vscode';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * QubesOS command paths
 */
const QUBES_COMMANDS = {
    COPY_TO_VM: '/usr/lib/qubes/qvm-copy-to-vm.gnome',
    MOVE_TO_VM: '/usr/lib/qubes/qvm-move-to-vm.gnome',
    OPEN_IN_DVM: '/usr/bin/qvm-open-in-dvm',
    CONVERT_PDF: '/usr/lib/qubes/qvm-convert-pdf.gnome',
    CONVERT_IMG: '/usr/lib/qubes/qvm-convert-img.gnome',
} as const;

/**
 * QubesOS marker files for detection
 */
const QUBES_MARKERS = [
    '/usr/bin/qvm-copy-to-vm',
    '/usr/bin/qvm-open-in-dvm',
    '/usr/lib/qubes',
    '/etc/qubes-release',
] as const;

/**
 * Operation context for Qubes commands
 */
interface QubesOperationContext {
    operation: string;
    fileCount: number;
}

/**
 * Path validation result
 */
interface PathValidationResult {
    valid: string[];
    invalid: string[];
}

/**
 * Image file extensions supported for conversion
 */
const IMAGE_EXTENSIONS = [
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.tif', '.webp', '.svg'
] as const;

/**
 * Check if a file is a PDF
 */
function isPdfFile(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.pdf');
}

/**
 * Check if a file is an image
 */
function isImageFile(filePath: string): boolean {
    const lowerPath = filePath.toLowerCase();
    return IMAGE_EXTENSIONS.some(ext => lowerPath.endsWith(ext));
}

/**
 * Check if the system is running QubesOS
 */
async function isQubesOS(): Promise<boolean> {
    try {
        // Check for QubesOS-specific directories and files
        for (const marker of QUBES_MARKERS) {
            if (fs.existsSync(marker)) {
                return true;
            }
        }
        return false;
    } catch (error) {
        console.error('Error detecting QubesOS:', error instanceof Error ? error.message : String(error));
        return false;
    }
}

/**
 * Escape shell arguments to prevent command injection
 */
function escapeShellArg(arg: string): string {
    // Use single quotes and escape any single quotes in the string
    return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Validate that paths exist and are accessible
 */
function validatePaths(paths: string[]): PathValidationResult {
    const valid: string[] = [];
    const invalid: string[] = [];

    for (const filePath of paths) {
        try {
            if (fs.existsSync(filePath)) {
                valid.push(filePath);
            } else {
                invalid.push(filePath);
            }
        } catch (error) {
            invalid.push(filePath);
        }
    }

    return { valid, invalid };
}

/**
 * Execute a QubesOS command with proper error handling
 */
async function executeQubesCommand(
    command: string,
    args: string[],
    context: QubesOperationContext
): Promise<void> {
    const escapedArgs = args.map(escapeShellArg);
    const fullCommand = `${command} ${escapedArgs.join(' ')}`;

    try {
        // Show progress notification for operations
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `${context.operation} ${context.fileCount} file${context.fileCount > 1 ? 's' : ''}...`,
            cancellable: false
        }, async () => {
            await execAsync(fullCommand);
        });

        // Show success notification if configured
        const config = vscode.workspace.getConfiguration('qubes');
        if (config.get<boolean>('showNotifications', true)) {
            vscode.window.showInformationMessage(`${context.operation} completed successfully`);
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`${context.operation} failed: ${errorMessage}`);
        throw error;
    }
}

/**
 * Handle copy to qube command
 */
async function copyToQube(uri: vscode.Uri, uris?: vscode.Uri[]): Promise<void> {
    const files = uris && uris.length > 0 ? uris : [uri];
    const paths = files.map(f => f.fsPath);

    // Validate paths
    const { valid, invalid } = validatePaths(paths);

    if (invalid.length > 0) {
        vscode.window.showWarningMessage(
            `${invalid.length} file(s) no longer exist and will be skipped`
        );
    }

    if (valid.length === 0) {
        vscode.window.showErrorMessage('No valid files to copy');
        return;
    }

    await executeQubesCommand(
        QUBES_COMMANDS.COPY_TO_VM,
        valid,
        { operation: 'Copy to qube', fileCount: valid.length }
    );
}

/**
 * Handle move to qube command
 */
async function moveToQube(uri: vscode.Uri, uris?: vscode.Uri[]): Promise<void> {
    const files = uris && uris.length > 0 ? uris : [uri];
    const paths = files.map(f => f.fsPath);

    // Validate paths
    const { valid, invalid } = validatePaths(paths);

    if (invalid.length > 0) {
        vscode.window.showWarningMessage(
            `${invalid.length} file(s) no longer exist and will be skipped`
        );
    }

    if (valid.length === 0) {
        vscode.window.showErrorMessage('No valid files to move');
        return;
    }

    // Confirm move operation
    const confirmation = await vscode.window.showWarningMessage(
        `Move ${valid.length} file(s) to another qube? This will delete them from the current qube after transfer.`,
        { modal: true },
        'Move',
        'Cancel'
    );

    if (confirmation !== 'Move') {
        return;
    }

    await executeQubesCommand(
        QUBES_COMMANDS.MOVE_TO_VM,
        valid,
        { operation: 'Move to qube', fileCount: valid.length }
    );
}

/**
 * Handle open in disposable VM command
 */
async function openInDisposable(uri: vscode.Uri, viewOnly: boolean = false): Promise<void> {
    const filePath = uri.fsPath;

    // Validate path
    if (!fs.existsSync(filePath)) {
        vscode.window.showErrorMessage('File no longer exists');
        return;
    }

    // Check if it's a directory
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
        vscode.window.showErrorMessage('Cannot open directories in disposable VM');
        return;
    }

    const args = viewOnly ? ['--view-only', filePath] : [filePath];
    const operation = viewOnly ? 'View in disposable qube' : 'Edit in disposable qube';

    await executeQubesCommand(
        QUBES_COMMANDS.OPEN_IN_DVM,
        args,
        { operation, fileCount: 1 }
    );
}

/**
 * Handle PDF conversion in disposable VM
 */
async function convertPdf(uri: vscode.Uri, uris?: vscode.Uri[]): Promise<void> {
    const files = uris && uris.length > 0 ? uris : [uri];
    const paths = files.map(f => f.fsPath);

    // Validate paths and filter for PDFs only
    const { valid, invalid } = validatePaths(paths);
    const pdfFiles = valid.filter(isPdfFile);
    const nonPdfCount = valid.length - pdfFiles.length;

    if (invalid.length > 0) {
        vscode.window.showWarningMessage(
            `${invalid.length} file(s) no longer exist and will be skipped`
        );
    }

    if (nonPdfCount > 0) {
        vscode.window.showWarningMessage(
            `${nonPdfCount} non-PDF file(s) will be skipped`
        );
    }

    if (pdfFiles.length === 0) {
        vscode.window.showErrorMessage('No valid PDF files to convert');
        return;
    }

    // Process files one at a time (as per official implementation)
    for (const pdfFile of pdfFiles) {
        await executeQubesCommand(
            QUBES_COMMANDS.CONVERT_PDF,
            [pdfFile],
            { operation: 'Convert PDF in disposable qube', fileCount: 1 }
        );
    }
}

/**
 * Handle image conversion in disposable VM
 */
async function convertImage(uri: vscode.Uri, uris?: vscode.Uri[]): Promise<void> {
    const files = uris && uris.length > 0 ? uris : [uri];
    const paths = files.map(f => f.fsPath);

    // Validate paths and filter for images only
    const { valid, invalid } = validatePaths(paths);
    const imageFiles = valid.filter(isImageFile);
    const nonImageCount = valid.length - imageFiles.length;

    if (invalid.length > 0) {
        vscode.window.showWarningMessage(
            `${invalid.length} file(s) no longer exist and will be skipped`
        );
    }

    if (nonImageCount > 0) {
        vscode.window.showWarningMessage(
            `${nonImageCount} non-image file(s) will be skipped`
        );
    }

    if (imageFiles.length === 0) {
        vscode.window.showErrorMessage('No valid image files to convert');
        return;
    }

    // Process files one at a time (as per official implementation)
    for (const imageFile of imageFiles) {
        await executeQubesCommand(
            QUBES_COMMANDS.CONVERT_IMG,
            [imageFile],
            { operation: 'Convert image in disposable qube', fileCount: 1 }
        );
    }
}

/**
 * Extension activation
 */
export async function activate(context: vscode.ExtensionContext) {
    console.log('QubesOS extension is activating...');

    // Check if running on QubesOS
    const config = vscode.workspace.getConfiguration('qubes');
    const autoDetect = config.get<boolean>('autoDetect', true);
    const isQubes = autoDetect ? await isQubesOS() : true;

    // Set context for menu visibility
    vscode.commands.executeCommand('setContext', 'qubes.isQubesOS', isQubes);

    if (isQubes) {
        console.log('QubesOS detected - enabling context menu actions');
    } else {
        console.log('QubesOS not detected - menu items will be hidden');
    }

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('qubes.copyToQube', async (uri: vscode.Uri, uris?: vscode.Uri[]) => {
            try {
                await copyToQube(uri, uris);
            } catch (error) {
                console.error('Copy to qube failed:', error);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('qubes.moveToQube', async (uri: vscode.Uri, uris?: vscode.Uri[]) => {
            try {
                await moveToQube(uri, uris);
            } catch (error) {
                console.error('Move to qube failed:', error);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('qubes.editInDisposable', async (uri: vscode.Uri) => {
            try {
                await openInDisposable(uri, false);
            } catch (error) {
                console.error('Edit in disposable failed:', error);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('qubes.viewInDisposable', async (uri: vscode.Uri) => {
            try {
                await openInDisposable(uri, true);
            } catch (error) {
                console.error('View in disposable failed:', error);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('qubes.convertPdf', async (uri: vscode.Uri, uris?: vscode.Uri[]) => {
            try {
                await convertPdf(uri, uris);
            } catch (error) {
                console.error('Convert PDF failed:', error);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('qubes.convertImage', async (uri: vscode.Uri, uris?: vscode.Uri[]) => {
            try {
                await convertImage(uri, uris);
            } catch (error) {
                console.error('Convert image failed:', error);
            }
        })
    );

    console.log('QubesOS extension activated successfully');
}

/**
 * Extension deactivation
 */
export function deactivate() {
    console.log('QubesOS extension deactivated');
}
