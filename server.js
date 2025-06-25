const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const JSZip = require('jszip');
const cors = require('cors'); 

const app = express();
const port = 4000;

// app.use(cors({
//     origin: '*',
//     methods: ['GET', 'POST', 'OPTIONS']
// }));  

app.use(cors());
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
});

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

  if (!projects || !Array.isArray(projects) || projects.length === 0) {
    return res.status(400).json({ error: 'Invalid or empty projects array.' });
  }

  console.log("2");
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
      { headers: { 'Content-Type': 'application/xml' } }
    );

    const token = authResponse.data.credentials?.token;
    console.log("token", token);
    if (!token) {
      return res.status(401).json({ error: 'Authentication failed.' });
    }

    const workbooksToDownload = projects.flatMap((project) =>
      project.workbooks?.map((workbook) => ({
        downloadUrl: workbook.downloadUrl,
        name: workbook.workbookName.endsWith('.twb') || workbook.workbookName.endsWith('.twbx')
          ? workbook.workbookName
          : `${workbook.workbookName}.twbx`,
      })) || []
    );
    console.log("workbooksToDownload", workbooksToDownload);

    if (workbooksToDownload.length === 0) {
      return res.status(400).json({ error: 'No workbooks to download.' });
    }

    const zip = new JSZip();

    const downloadPromises = workbooksToDownload.map(async (workbook) => {
      try {
        const downloadResponse = await axios.get(workbook.downloadUrl, {
          headers: { 'X-Tableau-Auth': token },
          responseType: 'arraybuffer',
        });
        console.log("downloadResponse", downloadResponse);

        const fileBuffer = Buffer.from(downloadResponse.data);
        console.log("fileBuffer", fileBuffer);
        zip.file(workbook.name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_'), fileBuffer);
        console.log(`Successfully added: ${workbook.name}`);
      } catch (error) {
        console.error(`Failed to download workbook: ${workbook.name}`, error.message);
        return workbook.name; // Return failed workbook name
      }
    });
    console.log("downloadPromises", downloadPromises);

    const failedWorkbooks = (await Promise.all(downloadPromises)).filter(Boolean);

    if (failedWorkbooks.length) {
      console.warn(`Workbooks that failed to download: ${failedWorkbooks.join(', ')}`);
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    console.log("zipBuffer", zipBuffer);

    res.setHeader('Content-Disposition', 'attachment; filename=workbooks.zip');
    res.setHeader('Content-Type', 'application/zip');
    res.send(zipBuffer);
  } catch (error) {
    console.error('Error processing request:', error.message);
    res.status(500).json({ error: 'Failed to download workbooks.' });
  }
});

app.post('/api/tableau/aiGenerate', async (req, res) => {
  try {
    const inputPayload = req.body;

    const response = await axios.post(
      "https://gwcteq-partner.domo.com/api/ai/v1/text/generation",
      inputPayload
    );

    res.status(200).json(response.data); // Send back only the response data
  } catch (error) {
    console.error("Domo API call failed:", error?.response?.data || error.message);
    res.status(error?.response?.status || 500).json({
      error: "Failed to generate chart type",
      details: error?.response?.data || error.message,
    });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
