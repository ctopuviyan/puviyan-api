# Use Node.js LTS version
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application files
COPY . .

# Set environment variables
ENV NODE_ENV=staging
ENV PORT=8080
ENV FIREBASE_PROJECT_ID=puviyan-stage

# Expose port
EXPOSE 8080

# Start the application
CMD ["node", "src/index.js"]
