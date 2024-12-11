const { app, BrowserWindow, ipcMain } = require('electron');
const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const http = require('http');
const appExpress = express();

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

let mainWindow;

// Initialize Electron window
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1920,
        height: 1080,
        webPreferences: {
            preload: path.join(__dirname, 'src', 'frontend.js'), // Point to your frontend JS file
            nodeIntegration: true, // Allow Node.js integration for accessing file system
        }
    });

    // Load your HTML page
    mainWindow.loadFile(path.join(__dirname, 'public', 'index.html'));
}

appExpress.use(cors());
appExpress.use(express.json()); // Parse JSON bodies
appExpress.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

const upload = multer({ dest: 'uploads/chunks/' }); // Temporary storage for chunks

const uploadDir = './uploads/chunks';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir); // Create directory for chunks if it doesn't exist
}
// Serve static files from the 'public' directory
appExpress.use(express.static(path.join(__dirname, 'public')));

// Serve your JavaScript files from the src folder
appExpress.use('/src', express.static(path.join(__dirname, 'src')));

appExpress.post('/extract-metadata', upload.single('file'), (req, res) => {
    const videoPath = req.file.path;  // Path to the uploaded file

    ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
            console.error('Error extracting metadata:', err);
            return res.status(500).json({ error: 'Failed to extract metadata' });
        }

        // Extract relevant metadata
        const filmIndustryMetadata = {
            format: metadata.format,
            streams: metadata.streams.map(stream => ({
                codec_name: stream.codec_name,          // Codec (e.g., h264, vp9)
                codec_long_name: stream.codec_long_name, // Full codec name
                width: stream.width,                    // Width of video
                height: stream.height,                  // Height of video
                frame_rate: stream.r_frame_rate,        // Frame rate (fps)
                bit_rate: stream.bit_rate,              // Bit rate (for video or audio)
                sample_rate: stream.sample_rate,        // Sample rate (for audio streams)
                channel_layout: stream.channel_layout,  // Channel layout (audio)
                color_space: stream.color_space,        // Color space (e.g., BT.709, BT.2020)
                color_range: stream.color_range,        // Color range (e.g., full or limited)
                aspect_ratio: stream.display_aspect_ratio || `${stream.width}:${stream.height}`, // Aspect ratio
            })),
            duration: metadata.format.duration,         // Duration of the video in seconds
            bitrate: metadata.format.bit_rate,          // Overall bit rate of the video
            filename: metadata.format.filename,         // File name
            size: metadata.format.size,                 // File size in bytes
            file_type: metadata.format.format_name     // File format (e.g., mp4, mkv)
        };

        // Delete the uploaded file after processing
        fs.unlinkSync(videoPath);

        // Return the metadata as JSON response
        res.json(filmIndustryMetadata);
    });
});

appExpress.put('/upload', upload.single('file'), (req, res) => {
    const contentRange = req.headers['content-range'];
    // Handle the chunk here
    const chunkFilename = req.headers['x-filename'];  // Original filename

    // Extract the range, for example "bytes 0-3145727/1526830745"
    const range = contentRange.match(/bytes (\d+)-(\d+)\/(\d+)/);
    const chunkStart = range[1];  // Start byte of this chunk
    const chunkEnd = range[2];    // End byte of this chunk
    const totalFileSize = range[3];   // Total size of the file
    const chunkSize = chunkEnd - chunkStart + 1;  // Size of this chunk
    const totalChunks = Math.ceil(totalFileSize / chunkSize);  // Total number of chunks

    // Create a unique filename for each chunk
    const chunkPartFilename = `${chunkFilename}.part${chunkStart}-${chunkEnd}`;

    const chunkPath = path.join(__dirname, 'uploads/chunks', chunkPartFilename);

    // Create a write stream to save the chunk temporarily
    const fileStream = fs.createWriteStream(chunkPath);
    req.pipe(fileStream);

    // Once all chunks are received, combine them into the final file
    fileStream.on('finish', () => {
        console.log(`Chunk uploaded: ${chunkPartFilename}`);

        // Reassemble the file after receiving all chunks
        // After receiving the last chunk, move to a "completed" file
        if (allChunksReceived(contentRange)) {
            reassembleFile(chunkFilename, totalChunks);
        }

        res.status(200).send({ message: 'Chunk uploaded successfully' });
    });
});

// Function to check if all chunks have been uploaded
function allChunksReceived(contentRange) {
        // Parse the content-range header to get the start and end byte positions
        const rangeMatch = contentRange.match(/bytes (\d+)-(\d+)\/(\d+)/);
        if (!rangeMatch) {
            console.error('Invalid content-range format:', contentRange);
            return false;  // Invalid range format, return false
        }
    
        const chunkEnd = parseInt(rangeMatch[2]);
        const totalFileSize = parseInt(rangeMatch[3]);
    
        // Check if the chunkEnd is equal to or greater than totalSize - 1
        // If the chunkEnd is the last byte or larger, it means this is the last chunk
        if (chunkEnd >= totalFileSize - 1) {
            return true;
        }
    
        return false;
    }

// Reassemble the file after all chunks are uploaded
function reassembleFile(filename, totalChunks) {
    const filePath = path.join('./uploads/', filename);  // Path for the final reassembled file
    const writeStream = fs.createWriteStream(filePath);

    // Get all chunk files for the given filename
    const chunkFiles = fs.readdirSync(path.join(__dirname, 'uploads/chunks')).filter(file => file.startsWith(filename));
    chunkFiles.sort((a, b) => {
        const aIndex = parseInt(a.split('.part')[1]);
        const bIndex = parseInt(b.split('.part')[1]);
        return aIndex - bIndex;
    });

    let chunksWritten = 0; // To track how many chunks have been written

    // Helper function to handle writing and cleanup
    function writeChunk(chunkIndex) {
        if (chunkIndex >= chunkFiles.length) {
            writeStream.end();
            console.log(`File ${filename} reassembled successfully.`);
            return;
        }

        const chunkPath = path.join(__dirname, 'uploads/chunks', chunkFiles[chunkIndex]);
        const chunkStream = fs.createReadStream(chunkPath);

        chunkStream.pipe(writeStream, { end: false });

        chunkStream.on('end', () => {
            console.log(`Chunk ${chunkIndex} appended successfully.`);
            fs.unlink(chunkPath, (err) => {
                if (err) {
                    console.error(`Error deleting chunk ${chunkIndex}:`, err);
                } else {
                    console.log(`Chunk ${chunkIndex} deleted.`);
                }
            });

            chunksWritten++;

            // Write the next chunk
            writeChunk(chunkIndex + 1);
        });

        chunkStream.on('error', (err) => {
            console.error(`Error reading chunk ${chunkIndex}:`, err);
        });
    }

    // Start writing the first chunk
    writeChunk(0);
}

// Start the server
const server = http.createServer(appExpress);
server.listen(3000, () => {
    console.log('Server is running on port 3000');
});

// Launch the Electron window
app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
