# SQLMind Studio

SQLMind Studio is a Windows-based SQL editor and database management tool designed specifically for Microsoft SQL Server and Azure SQL Database.

It extends and modifies the open-source Beekeeper Studio codebase with a focused SQL Server workflow and advanced AI-assisted features designed to help database administrators and SQL professionals.

Website:  
https://sqltools.co

## Users

### Download

Download the latest Windows build:  
https://sqltools.co/download

SQLMind Studio is currently available for **Windows only**.


### Pricing and licensing

SQLMind Studio offers a **free trial** with limited usage.

Paid **per-user subscription plans** are available for individuals, teams, and enterprises.  
Plans unlock advanced features such as AI-assisted analysis, performance recommendations, collaboration features, and enterprise capabilities.

Full plan and pricing details are available at:  
https://sqltools.co/pricing


### Supported Databases

| Database                                                 | Support         | Community | Paid Editions | SQLMind Links |
| :------------------------------------------------------- | :-------------- | :-------: | :-----------: | ------------: |
| [Microsoft SQL Server Database]                          | ⭐ Full Support |    ✅    |      ✅       | [Features](https://sqltools.co/features) |
| [Azure SQL Database]                                     | ⭐ Full Support |    ✅    |      ✅       | [Features](https://sqltools.co/features) |



### Highlights

- Native Windows desktop application
- SQL editor with syntax highlighting and autocomplete
- Tabs and query history
- Data grid with sorting and filtering
- Import and export utilities
- Advanced AI-assisted features for SQL Server administration
- Focused exclusively on SQL Server and Azure SQL workloads


## Developers

This repository contains the source code for SQLMind Studio.


### Prerequisites

- Node.js 20
- Yarn (classic)


### Install

```bash
yarn install
### Run the desktop app (development)
From the repo root:

yarn electron:serve
### Build the desktop app
yarn electron:build
### Repository structure
apps/studio
The SQLMind Studio Electron + Vue application.

apps/ui-kit
Shared UI components used by the app.

### Tests
yarn test:unit
yarn test:e2e
```

### Contributing
Code of conduct: https://github.com/sqlmind-studio/sqlmind-studio?tab=coc-ov-file

Contributing guide: https://github.com/sqlmind-studio/sqlmind-studio?tab=contributing-ov-file

### Trademarks
This software is derived from the source code for Beekeeper Studio.

Beekeeper Studio is a trademark of Beekeeper Studio, Inc.
SQLMind Studio is an independent product and is not affiliated with, endorsed by, or sponsored by Beekeeper Studio, Inc.

All other product names, logos, and brands are the property of their respective owners.

### License
This project is licensed under the GNU General Public License v3 (GPLv3).

Trademarks (including word marks and logos) are not licensed and remain the property of their respective owners.

