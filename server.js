const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const JSZip = require('jszip');
const cors = require('cors'); 

const app = express();
const port = 4000;

app.use(cors({
    origin: '*'
}));  

app.use(bodyParser.json());

const handleError = (res, message) => {
  console.error(message);
  res.status(500).json({ error: message });
};

app.post('/api/tableau/projects', async (req, res) => {
  const { username, password, instance } = req.body;

  try {
    const xmlBody = `
      <tsRequest>
        <credentials name="${username}" password="${password}">
            <site contentUrl="" />
        </credentials>
      </tsRequest>
    `;
    const authResponse = await axios.post(
      `https://${instance}/api/3.24/auth/signin`,
      xmlBody,
      {
        headers: {
          'Content-Type': 'application/xml'
        },
      }
    );

    const token = authResponse.data.credentials.token;
    const siteId = authResponse.data.credentials.site.id;

    const projectsResponse = await axios.get(
      `https://${instance}/api/3.9/sites/${siteId}/projects`,
      {
        headers: {
          'X-Tableau-Auth': token
        }
      }
    );

    const projects = projectsResponse.data.projects.project;
    console.log("projects", projects);

    const projectWithWorkbooks = [];

    try {
      const workbooksResponse = await axios.get(
        `https://${instance}/api/3.24/sites/${siteId}/workbooks`,
        {
          headers: {
            'X-Tableau-Auth': token
          }
        }
      );

      const workbooks = workbooksResponse.data.workbooks && workbooksResponse.data.workbooks.workbook
        ? workbooksResponse.data.workbooks.workbook
        : [];

      console.log("workbooks", workbooks);

      const workbooksWithDownloadUrls = workbooks.map(workbook => ({
        id: workbook.id,
        name: workbook.name,
        projectId: workbook.project.id,
        webpageUrl: workbook.webpageUrl,
        createdAt: workbook.createdAt,
        updatedAt: workbook.updatedAt,
        downloadUrl: `https://${instance}/api/3.24/sites/${siteId}/workbooks/${workbook.id}/content`
      }));

      projects.forEach(project => {
        const projectWorkbooks = workbooksWithDownloadUrls.filter(workbook => workbook.projectId === project.id);
        projectWithWorkbooks.push({
          projectId: project.id,
          projectName: project.name,
          description: project.description,
          workbooks: projectWorkbooks.map(workbook => ({
            workbookId: workbook.id,
            workbookName: workbook.name,
            webpageUrl: workbook.webpageUrl,
            downloadUrl: workbook.downloadUrl,
            createdAt: workbook.createdAt,
            updatedAt: workbook.updatedAt,
          }))
        });
      });

    } catch (error) {
      handleError(res, 'Error fetching workbooks');
      projects.forEach(project => {
        projectWithWorkbooks.push({
          ...project,
          workbooks: []
        });
      });
    }

    res.json(projectWithWorkbooks);

  } catch (error) {
    handleError(res, 'Failed to fetch projects');
  }
});

app.post('/api/tableau/downloadWorkbooks', async (req, res) => {
  const { username, password, instance, projects } = req.body;

  try {
    const xmlBody = `
      <tsRequest>
        <credentials name="${username}" password="${password}">
            <site contentUrl="" />
        </credentials>
      </tsRequest>
    `;
    
    const authResponse = await axios.post(
      `https://${instance}/api/3.24/auth/signin`,
      xmlBody,
      {
        headers: {
          'Content-Type': 'application/xml',
        },
      }
    );

    const token = authResponse.data.credentials.token;
    console.log("Token:", token);

    if (!projects || !Array.isArray(projects)) {
      return res.status(400).json({ error: 'Invalid projects data' });
    }

    const workbooksToDownload = [];
    projects.forEach(project => {
      if (project.workbooks && Array.isArray(project.workbooks)) {
        project.workbooks.forEach(workbook => {
          workbooksToDownload.push({
            downloadUrl: workbook.downloadUrl,
            name: workbook.workbookName.endsWith('.twb') || workbook.workbookName.endsWith('.twbx')
              ? workbook.workbookName
              : `${workbook.workbookName}.twbx`,
          });
        });
      }
    });

    if (workbooksToDownload.length === 0) {
      return res.status(400).json({ error: 'No workbooks to download' });
    }

    const zip = new JSZip();
    let extractedFile = [];

    // Download each workbook and add to the zip file
    for (const workbook of workbooksToDownload) {
      try {
        const downloadResponse = await axios.get(workbook.downloadUrl, {
          headers: {
            'X-Tableau-Auth': token,
          },
          responseType: 'arraybuffer',
        });

        const fileBuffer = Buffer.from(downloadResponse.data);
        extractedFile.push(fileBuffer);
        zip.file(workbook.name, fileBuffer);
        console.log(`Successfully added: ${workbook.name}`);
      } catch (error) {
        console.error(`Failed to download workbook: ${workbook.name}`, error.message);
      }
    }

    // Generate the zip file
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    // Send the zip file to the client for download
    res.setHeader('Content-Disposition', 'attachment; filename=workbooks.zip');
    res.setHeader('Content-Type', 'application/zip');
    res.send(extractedFile);
    
  } catch (error) {
    console.error('Error processing request:', error);
    res.status(500).json({ error: 'Failed to download workbooks' });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
