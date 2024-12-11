document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('filePicker');
  const uploadFileBtn = document.getElementById('uploadFileBtn');
  const extractMetadataBtn = document.getElementById('extractMetadataBtn');
  const metadataDiv = document.getElementById('metadata');

  let selectedFile = null;

  // Enable the extract button when a file is selected
  fileInput.addEventListener('change', (event) => {
    selectedFile = event.target.files[0];
    console.log('File selected:', selectedFile);
    if (selectedFile) {
        extractMetadataBtn.disabled = false; // Enable the button
        uploadFileBtn.disabled = false;
    }
});

  uploadFileBtn.addEventListener('click', () => {
      if (selectedFile) {
        const upload = UpChunk.createUpload({
          file: selectedFile,  // File selected by the user
          chunkSize: 1024*30, // 3 MB chunk size
          endpoint: 'http://localhost:3000/upload',
          headers: {
            'x-filename': selectedFile.name,  // Make sure the filename is sent
        },
        });

        // Subscribe to events
        upload.on('error', (err) => {
          console.error('Error during upload:', err.detail);
        });

        upload.on('progress', (progress) => {
          console.log(`Upload Progress: ${Math.round(progress.detail)}%`);
        });

        upload.on('success', () => {
          console.log("Upload completed successfully!");
        });
      };
  });

  // When the "Extract Metadata" button is clicked, send the file to the server
  extractMetadataBtn.addEventListener('click', async () => {
    if (selectedFile) {
      const formData = new FormData();
      formData.append('file', selectedFile);  // Append file to FormData

      try {
        const response = await fetch('http://localhost:3000/extract-metadata', {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            throw new Error('Failed to fetch metadata');
        }

        // Get the metadata JSON response from the server
        const metadata = await response.json();
        // Display the metadata on the page
        metadataDiv.innerHTML = `<pre>${JSON.stringify(metadata, null, 2)}</pre>`;
      } catch (error) {
          console.error('Error extracting metadata:', error);
      }
    }
  });
});


