FROM node:20-slim

# Instalar dependencias del sistema: Poppler (pdftotext, pdftoppm) y Tesseract OCR con español
RUN apt-get update && apt-get install -y \
    poppler-utils \
    tesseract-ocr \
    tesseract-ocr-spa \
    && rm -rf /var/lib/apt/lists/*

# Crear directorio de trabajo
WORKDIR /app

# Copiar package.json e instalar dependencias
COPY package.json ./
RUN npm install --production

# Copiar código de la aplicación
COPY server.js ./

# Exponer puerto
EXPOSE 3000

# Variable de entorno para el puerto (Render lo sobreescribirá)
ENV PORT=3000
ENV MAX_OCR_PAGES=5

# Comando para iniciar
CMD ["node", "server.js"]
