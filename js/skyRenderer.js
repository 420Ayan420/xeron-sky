class SkyRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = canvas.getContext('webgl', { alpha: false }) || canvas.getContext('experimental-webgl', { alpha: false });
        if (!this.gl) {
            throw new Error('WebGL not supported');
        }

        // Create 2D context for overlays
        this.overlayCanvas = document.createElement('canvas');
        this.overlayCanvas.style.position = 'absolute';
        this.overlayCanvas.style.top = '0';
        this.overlayCanvas.style.left = '0';
        this.overlayCanvas.style.width = '100%';
        this.overlayCanvas.style.height = '100%';
        this.overlayCanvas.style.pointerEvents = 'none';
        canvas.parentNode.appendChild(this.overlayCanvas);
        this.ctx2d = this.overlayCanvas.getContext('2d');

        // Add visibility settings first
        this.visibility = {
            showGrid: true,
            showLabels: true,
            showConstellations: true,
            showMeteors: true,
            showStars: true,
            showNebulae: true,
            showGalaxies: true,
            showClusters: true
        };

        // Create projection selector menu
        this.createProjectionMenu();

        // Initialize WebGL context and resources
        this.initializeGL(this.gl);
        this.initShaders(this.gl);
        this.initBuffers(this.gl);

        // Add pan parameters
        this.pan = { x: 0, y: 0 };
        this.scale = 1.0;
        this.rotation = { x: 0, y: 0 };
        this.zoom = 2.0;
        this.projectionType = 'spherical';  // Default projection
        
        // Initialize meteor showers array
        this.meteorShowers = [];
        
        // Initialize grid
        this.initGrid();
        
        // Bind events
        this.bindEvents(canvas);

        // Initial resize
        this.resize();
    }

    createProjectionMenu() {
        // Create menu container
        const menu = document.createElement('div');
        menu.style.position = 'absolute';
        menu.style.top = '10px';
        menu.style.right = '10px';
        menu.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        menu.style.padding = '10px';
        menu.style.borderRadius = '5px';
        menu.style.zIndex = '1000';

        // Create select element
        const select = document.createElement('select');
        select.style.backgroundColor = '#222';
        select.style.color = '#fff';
        select.style.border = '1px solid #444';
        select.style.padding = '5px';
        select.style.borderRadius = '3px';
        select.style.cursor = 'pointer';

        // Add projection options
        const projections = [
            { value: 'spherical', label: 'Spherical (3D)' },
            { value: 'stereographic', label: 'Stereographic' },
            { value: 'mercator', label: 'Mercator' },
            { value: 'hammer', label: 'Hammer-Aitoff' }
        ];

        projections.forEach(proj => {
            const option = document.createElement('option');
            option.value = proj.value;
            option.textContent = proj.label;
            select.appendChild(option);
        });

        // Add change event listener
        select.addEventListener('change', (e) => {
            this.setProjection(e.target.value);
            this.render();
        });

        menu.appendChild(select);
        this.canvas.parentNode.appendChild(menu);
    }

    initializeGL(gl) {
        gl.clearColor(0.0, 0.02, 0.05, 1.0);
        gl.enable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    }

    positionCanvases() {
        this.canvases.spherical.style.left = '0';
        this.canvases.spherical.style.top = '0';
        
        this.canvases.stereographic.style.right = '0';
        this.canvases.stereographic.style.top = '0';
        
        this.canvases.mercator.style.left = '0';
        this.canvases.mercator.style.bottom = '0';
        
        this.canvases.hammer.style.right = '0';
        this.canvases.hammer.style.bottom = '0';
    }

    setProjection(type) {
        const validTypes = ['spherical', 'stereographic', 'mercator', 'hammer'];
        if (validTypes.includes(type)) {
            this.projectionType = type;
            if (this.stars) {
                this.updateStarData(this.stars);
            }
        }
    }

    initShaders(gl) {
        // Vertex shader program for stars
        const vsSource = `
            attribute vec3 aPosition;
            attribute float aMagnitude;
            attribute vec3 aColor;
            
            uniform mat4 uModelViewMatrix;
            uniform mat4 uProjectionMatrix;
            
            varying float vMagnitude;
            varying vec3 vColor;
            
            void main() {
                vec4 pos = uProjectionMatrix * uModelViewMatrix * vec4(aPosition, 1.0);
                gl_Position = pos;
                float size = pow(2.0, (6.0 - aMagnitude)) * 2.0;
                gl_PointSize = max(size / pos.w, 1.0);
                vMagnitude = aMagnitude;
                vColor = aColor;
            }
        `;

        // Fragment shader program for stars
        const fsSource = `
            precision mediump float;
            varying float vMagnitude;
            varying vec3 vColor;
            
            void main() {
                vec2 center = gl_PointCoord - vec2(0.5);
                float dist = length(center);
                
                // Simple circle with hard edge
                if (dist > 0.5) discard;
                
                float brightness = pow(2.0, -vMagnitude * 0.5);
                
                // Use pure star color without mixing or gradients
                vec3 color = vColor * 1.5;  // Boost color intensity
                
                gl_FragColor = vec4(color, brightness);
            }
        `;

        // Create shader program for this context
        const program = this.createShaderProgram(gl, vsSource, fsSource);
        this.starProgram = program;
        
        // Get attribute locations for this context
        this.starAttributes = {
            position: gl.getAttribLocation(program, 'aPosition'),
            magnitude: gl.getAttribLocation(program, 'aMagnitude'),
            color: gl.getAttribLocation(program, 'aColor')
        };

        // Get uniform locations for this context
        this.starUniforms = {
            modelView: gl.getUniformLocation(program, 'uModelViewMatrix'),
            projection: gl.getUniformLocation(program, 'uProjectionMatrix')
        };
    }

    createShaderProgram(gl, vsSource, fsSource) {
        const vertexShader = this.compileShader(gl, vsSource, gl.VERTEX_SHADER);
        const fragmentShader = this.compileShader(gl, fsSource, gl.FRAGMENT_SHADER);
        
        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            gl.deleteProgram(program);
            throw new Error('Unable to initialize shader program: ' + gl.getProgramInfoLog(program));
        }

        return program;
    }

    compileShader(gl, source, type) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            gl.deleteShader(shader);
            throw new Error('Shader compile error: ' + gl.getShaderInfoLog(shader));
        }

        return shader;
    }

    initBuffers(gl) {
        // Create buffers for this context
        this.starBuffers = {
            position: gl.createBuffer(),
            magnitude: gl.createBuffer(),
            color: gl.createBuffer()
        };
    }

    bindEvents(canvas) {
        let isDragging = false;
        let lastX = 0;
        let lastY = 0;

        canvas.addEventListener('mousedown', (e) => {
            isDragging = true;
            lastX = e.clientX;
            lastY = e.clientY;
        });

        canvas.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            
            const deltaX = e.clientX - lastX;
            const deltaY = e.clientY - lastY;
            
            if (this.projectionType === 'spherical') {
                // 3D rotation for spherical projection
                this.rotation.x += deltaY * 0.005;
                this.rotation.y += deltaX * 0.005;
            } else {
                // 2D pan for flat projections
                // Scale the pan delta by the view scale
                const scaleFactor = 2.0 / (this.scale * this.gl.canvas.width);
                this.pan.x += deltaX * scaleFactor;
                this.pan.y -= deltaY * scaleFactor;  // Invert Y for correct pan direction
            }
            
            lastX = e.clientX;
            lastY = e.clientY;
            
            this.render();
        });

        canvas.addEventListener('mouseup', () => {
            isDragging = false;
        });

        canvas.addEventListener('mouseleave', () => {
            isDragging = false;
        });

        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            
            if (this.projectionType === 'spherical') {
                // 3D zoom for spherical projection
                this.zoom *= e.deltaY > 0 ? 0.9 : 1.1;
                this.zoom = Math.max(0.1, Math.min(this.zoom, 5.0));
            } else {
                // 2D zoom for flat projections
                const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
                
                // Get mouse position in canvas coordinates
                const rect = canvas.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;
                
                // Convert to normalized device coordinates (-1 to 1)
                const ndcX = (mouseX / canvas.width) * 2 - 1;
                const ndcY = 1 - (mouseY / canvas.height) * 2;
                
                // Adjust pan to zoom around mouse position
                this.pan.x = (this.pan.x - ndcX) * zoomFactor + ndcX;
                this.pan.y = (this.pan.y - ndcY) * zoomFactor + ndcY;
                
                // Update scale
                this.scale *= zoomFactor;
                this.scale = Math.max(0.1, Math.min(this.scale, 10.0));
            }
            
            this.render();
        });

        window.addEventListener('resize', () => {
            this.resize();
        });
    }

    resize() {
        const displayWidth = this.canvas.clientWidth;
        const displayHeight = this.canvas.clientHeight;

        if (this.canvas.width !== displayWidth || this.canvas.height !== displayHeight) {
            this.canvas.width = displayWidth;
            this.canvas.height = displayHeight;
            this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);
            
            // Resize 2D canvas
            this.ctx2d.canvas.width = displayWidth;
            this.ctx2d.canvas.height = displayHeight;
        }
    }

    updateStarData(stars) {
        if (!stars || stars.length === 0) {
            console.error('No stars provided to updateStarData');
            return;
        }

        this.stars = stars;
        const transformedStars = this.transformStarsForProjection(stars, this.projectionType);
        
        const positions = new Float32Array(transformedStars.length * 3);
        const magnitudes = new Float32Array(transformedStars.length);
        const colors = new Float32Array(transformedStars.length * 3);

        transformedStars.forEach((star, i) => {
            positions[i * 3] = star.x;
            positions[i * 3 + 1] = star.y;
            positions[i * 3 + 2] = star.z;
            magnitudes[i] = star.magnitude;
            
            const [r, g, b] = star.spectralType ? 
                this.spectralTypeToRGB(star.spectralType) :
                this.colorIndexToRGB(star.colorIndex);
            
            colors[i * 3] = r;
            colors[i * 3 + 1] = g;
            colors[i * 3 + 2] = b;
        });

        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.starBuffers.position);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, positions, this.gl.STATIC_DRAW);

        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.starBuffers.magnitude);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, magnitudes, this.gl.STATIC_DRAW);

        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.starBuffers.color);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, colors, this.gl.STATIC_DRAW);

        this.starCount = transformedStars.length;
    }

    drawStars() {
        if (!this.starCount) {
            console.warn('No stars to draw');
            return;
        }

        this.gl.useProgram(this.starProgram);

        // Update matrices
        this.gl.uniformMatrix4fv(this.starUniforms.projection, false, this.projectionMatrix);
        this.gl.uniformMatrix4fv(this.starUniforms.modelView, false, this.modelViewMatrix);

        // Enable blending for better star appearance
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE);

        // Bind position buffer
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.starBuffers.position);
        this.gl.vertexAttribPointer(this.starAttributes.position, 3, this.gl.FLOAT, false, 0, 0);
        this.gl.enableVertexAttribArray(this.starAttributes.position);

        // Bind magnitude buffer
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.starBuffers.magnitude);
        this.gl.vertexAttribPointer(this.starAttributes.magnitude, 1, this.gl.FLOAT, false, 0, 0);
        this.gl.enableVertexAttribArray(this.starAttributes.magnitude);

        // Bind color buffer
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.starBuffers.color);
        this.gl.vertexAttribPointer(this.starAttributes.color, 3, this.gl.FLOAT, false, 0, 0);
        this.gl.enableVertexAttribArray(this.starAttributes.color);

        // Draw stars
        this.gl.drawArrays(this.gl.POINTS, 0, this.starCount);

        // Check for WebGL errors
        const error = this.gl.getError();
        if (error !== this.gl.NO_ERROR) {
            console.error('WebGL error during star rendering:', error);
        }

        // Cleanup
        this.gl.disableVertexAttribArray(this.starAttributes.position);
        this.gl.disableVertexAttribArray(this.starAttributes.magnitude);
        this.gl.disableVertexAttribArray(this.starAttributes.color);
        this.gl.disable(this.gl.BLEND);
    }

    drawDeepSkyObjects() {
        if (!this.deepSkyObjects || !this.ctx2d) return;
        
        const ctx = this.ctx2d;
        
        Object.entries(this.deepSkyObjects).forEach(([type, objects]) => {
            if (!Array.isArray(objects)) return;
            
            objects.forEach(obj => {
                if (!obj || typeof obj.ra === 'undefined' || typeof obj.dec === 'undefined') return;

                const coords = this.equatorialToCartesian(obj.ra, obj.dec);
                const pos = this.projectPoint(coords);
                if (!pos) return;

                const size = Math.max(20, (obj.size || 10) * this.zoom);
                
                // Different rendering based on object type
                switch(obj.type) {
                    case 'diffuse':
                    case 'planetary':
                    case 'supernova':
                        this.drawNebula(ctx, pos, size, obj);
                        break;
                    case 'spiral':
                    case 'galaxy':
                        this.drawGalaxy(ctx, pos, size, obj);
                        break;
                    case 'globular':
                    case 'open':
                        this.drawCluster(ctx, pos, size, obj);
                        break;
                }

                // Add labels for bright objects
                if (obj.magnitude < 8) {
                    ctx.fillStyle = 'rgba(200, 200, 255, 0.8)';
                    ctx.font = '12px Arial';
                    ctx.fillText(`${obj.name} (${obj.type})`, pos.x + size + 5, pos.y);
                }
            });
        });
    }

    drawNebula(ctx, pos, size, obj) {
        try {
            // Ensure all values are finite
            const x = Number(pos.x) || 0;
            const y = Number(pos.y) || 0;
            const s = Math.min(Math.max(Number(size) || 20, 10), 1000);
            const color = obj.color || [0.8, 0.6, 0.9];

            // Create complex gradient for nebula
                const gradient = ctx.createRadialGradient(
                    x, y, 0,
                x, y, s
                );

            // Multiple color stops for more complex appearance
            gradient.addColorStop(0, `rgba(${color[0]*255}, ${color[1]*255}, ${color[2]*255}, 0.8)`);
            gradient.addColorStop(0.3, `rgba(${color[0]*255}, ${color[1]*255}, ${color[2]*255}, 0.6)`);
            gradient.addColorStop(0.7, `rgba(${color[0]*255}, ${color[1]*255}, ${color[2]*255}, 0.3)`);
                gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

            // Draw main nebula shape
                ctx.beginPath();
            ctx.arc(x, y, s, 0, Math.PI * 2);
                ctx.fillStyle = gradient;
                ctx.fill();

            // Add internal structure
            for (let i = 0; i < 5; i++) {
                const angle = Math.random() * Math.PI * 2;
                const distance = Math.random() * s * 0.7;
                const subSize = s * (0.2 + Math.random() * 0.3);
                    
                const sx = x + Math.cos(angle) * distance;
                const sy = y + Math.sin(angle) * distance;
                    
                const subGradient = ctx.createRadialGradient(sx, sy, 0, sx, sy, subSize);
                subGradient.addColorStop(0, `rgba(${color[0]*255}, ${color[1]*255}, ${color[2]*255}, 0.6)`);
                subGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
                    
                    ctx.beginPath();
                ctx.arc(sx, sy, subSize, 0, Math.PI * 2);
                ctx.fillStyle = subGradient;
                    ctx.fill();
                }
        } catch (error) {
            console.error('Error drawing nebula:', error);
        }
    }

    drawGalaxy(ctx, pos, size, obj) {
        // Create spiral galaxy effect
            const numArms = 4;
            const rotations = 2;
            
            for (let arm = 0; arm < numArms; arm++) {
                const startAngle = (arm / numArms) * Math.PI * 2;
                
                ctx.beginPath();
            for (let t = 0; t <= 1; t += 0.01) {
                    const angle = startAngle + t * Math.PI * 2 * rotations;
                const scale = t * size;
                const x = pos.x + Math.cos(angle) * scale;
                const y = pos.y + Math.sin(angle) * scale;
                    
                if (t === 0) {
                    ctx.moveTo(x, y);
                    } else {
                    ctx.lineTo(x, y);
                    }
                }
                
            const gradient = ctx.createLinearGradient(
                pos.x - size, pos.y - size,
                pos.x + size, pos.y + size
                );
            gradient.addColorStop(0, `rgba(${obj.color[0]*255}, ${obj.color[1]*255}, ${obj.color[2]*255}, 0.8)`);
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
                
            ctx.strokeStyle = gradient;
            ctx.lineWidth = 2;
                ctx.stroke();
        }
    }

    drawCluster(ctx, pos, size, obj) {
        // Draw multiple stars in a cluster pattern
        const numStars = obj.type === 'globular' ? 50 : 20;
        
        for (let i = 0; i < numStars; i++) {
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * size * (obj.type === 'globular' ? 0.5 : 0.8);
            const starSize = 2 + Math.random() * 3;
            
            const x = pos.x + Math.cos(angle) * distance;
            const y = pos.y + Math.sin(angle) * distance;
            
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, starSize);
            gradient.addColorStop(0, `rgba(${obj.color[0]*255}, ${obj.color[1]*255}, ${obj.color[2]*255}, 0.8)`);
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            
            ctx.beginPath();
            ctx.arc(x, y, starSize, 0, Math.PI * 2);
            ctx.fillStyle = gradient;
            ctx.fill();
        }
    }

    drawMeteorShowers() {
        if (!this.meteorShowers || !Array.isArray(this.meteorShowers)) return;
        
        const ctx = this.ctx2d;
        
        this.meteorShowers.forEach(shower => {
            if (!shower || !shower.active || !shower.radiant) return;
            
            const pos = this.projectPoint(shower.radiant);
            if (!pos) return;

            // Draw radiant point with glow
            try {
                const radiantGradient = ctx.createRadialGradient(
                    pos.x, pos.y, 0,
                    pos.x, pos.y, 20
                );
                radiantGradient.addColorStop(0, `rgba(${shower.color[0]*255}, ${shower.color[1]*255}, ${shower.color[2]*255}, 0.8)`);
                radiantGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
                
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, 20, 0, Math.PI * 2);
                ctx.fillStyle = radiantGradient;
                ctx.fill();

                // Draw label
                ctx.fillStyle = 'rgba(200, 200, 255, 0.8)';
                ctx.font = '12px Arial';
                ctx.fillText(`${shower.name} (${shower.zhr}/hr)`, pos.x + 25, pos.y);

                // Draw meteors with trails and particle effects
                const numMeteors = Math.min(8, shower.zhr / 15);
                for (let i = 0; i < numMeteors; i++) {
                    this.drawMeteorWithParticles(ctx, pos, shower);
                }
            } catch (error) {
                console.error('Error drawing meteor shower:', error);
            }
        });
    }

    drawMeteorWithParticles(ctx, radiant, shower) {
            const angle = Math.random() * Math.PI * 2;
        const length = 100 + Math.random() * 100;
            const speed = shower.speed / 30;
            
        const endX = radiant.x + Math.cos(angle) * length;
        const endY = radiant.y + Math.sin(angle) * length;
            
            // Draw main meteor trail
        const gradient = ctx.createLinearGradient(radiant.x, radiant.y, endX, endY);
        gradient.addColorStop(0, `rgba(${shower.color[0]*255}, ${shower.color[1]*255}, ${shower.color[2]*255}, 0.8)`);
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
            
            ctx.beginPath();
        ctx.moveTo(radiant.x, radiant.y);
            ctx.lineTo(endX, endY);
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 2;
            ctx.stroke();
            
        // Add particle effects
        const numParticles = 10;
            for (let i = 0; i < numParticles; i++) {
                const t = i / numParticles;
            const x = radiant.x + (endX - radiant.x) * t;
            const y = radiant.y + (endY - radiant.y) * t;
                
            const particleGradient = ctx.createRadialGradient(x, y, 0, x, y, 3);
            particleGradient.addColorStop(0, `rgba(${shower.color[0]*255}, ${shower.color[1]*255}, ${shower.color[2]*255}, ${0.5 * (1-t)})`);
            particleGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
                
                ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
                ctx.fillStyle = particleGradient;

                ctx.fill();
        }
    }

    setVisibility(setting, value) {
        if (setting in this.visibility) {
            this.visibility[setting] = value;
        }
    }

    render() {
        this.resize();

        // Clear canvases
        this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
        if (this.ctx2d) {
            this.ctx2d.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
        }

        // Update matrices
        this.updateMatrices();

        // Draw elements based on visibility settings
        if (this.visibility.showGrid && this.gridLines) {
            this.drawGrid(this.projectionType);
        }

        if (this.visibility.showStars && this.stars) {
            this.drawStars();
        }

        if ((this.visibility.showNebulae || this.visibility.showGalaxies || this.visibility.showClusters) && this.deepSkyObjects) {
            this.drawDeepSkyObjects();
        }

        if (this.visibility.showMeteors && this.meteorShowers) {
            this.drawMeteorShowers();
        }
    }

    updateMatrices() {
        if (this.projectionType === 'spherical') {
            // 3D projection matrix for spherical view
            const fieldOfView = 60 * Math.PI / 180;
            const aspect = this.gl.canvas.clientWidth / this.gl.canvas.clientHeight;
            const zNear = 0.1;
            const zFar = 100.0;
            
            const projectionMatrix = mat4.create();
            mat4.perspective(projectionMatrix, fieldOfView, aspect, zNear, zFar);

            const modelViewMatrix = mat4.create();
            mat4.identity(modelViewMatrix);
            mat4.translate(modelViewMatrix, modelViewMatrix, [0.0, 0.0, -2.0]);
            mat4.rotate(modelViewMatrix, modelViewMatrix, this.rotation.x, [1, 0, 0]);
            mat4.rotate(modelViewMatrix, modelViewMatrix, this.rotation.y, [0, 1, 0]);
            mat4.scale(modelViewMatrix, modelViewMatrix, [this.zoom, this.zoom, this.zoom]);

            this.modelViewMatrix = modelViewMatrix;
            this.projectionMatrix = projectionMatrix;
        } else {
            // Orthographic projection matrix for flat projections
            const width = this.gl.canvas.clientWidth;
            const height = this.gl.canvas.clientHeight;
            const aspect = width / height;
            
            // Calculate view dimensions based on scale
            const viewWidth = 4.0;
            const viewHeight = viewWidth / aspect;
            
            const projectionMatrix = mat4.create();
            mat4.ortho(projectionMatrix, 
                -viewWidth/2, viewWidth/2,
                -viewHeight/2, viewHeight/2,
                -1, 1);

            const modelViewMatrix = mat4.create();
            mat4.identity(modelViewMatrix);
            
            // Apply scale first
            mat4.scale(modelViewMatrix, modelViewMatrix, [this.scale, this.scale, 1]);
            
            // Then apply pan
            mat4.translate(modelViewMatrix, modelViewMatrix, [this.pan.x / this.scale, this.pan.y / this.scale, 0]);

            this.modelViewMatrix = modelViewMatrix;
            this.projectionMatrix = projectionMatrix;
        }

        this.currentModelView = this.modelViewMatrix;
        this.currentProjection = this.projectionMatrix;
    }

    drawGrid(type) {
        if (!this.gridLines || !this.ctx2d) return;
        
        const ctx = this.ctx2d;
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        
        // Transform grid lines based on projection type
        this.gridLines.forEach(line => {
            ctx.beginPath();
            ctx.strokeStyle = line.color;
            ctx.lineWidth = 1;
            
            let first = true;
            line.points.forEach(point => {
                // Transform point based on projection type
                let transformedPoint = point;
                if (type !== 'spherical') {
                    switch(type) {
                        case 'stereographic':
                            transformedPoint = this.equatorialToStereographic(point.ra, point.dec);
                            break;
                        case 'mercator':
                            transformedPoint = this.equatorialToMercator(point.ra, point.dec);
                            break;
                        case 'hammer':
                            transformedPoint = this.equatorialToHammer(point.ra, point.dec);
                            break;
                    }
                }
                
                // Project point to screen space
                const pos = this.projectPoint(transformedPoint);
                if (pos) {
                    if (first) {
                        ctx.moveTo(pos.x, pos.y);
                        first = false;
                    } else {
                        ctx.lineTo(pos.x, pos.y);
                    }
                }
            });
            
            ctx.stroke();
        });
    }

    projectPoint(point) {
        // Create point matrix
        const pos = vec4.fromValues(point.x, point.y, point.z, 1.0);
        
        // Transform point
        vec4.transformMat4(pos, pos, this.currentModelView);
        vec4.transformMat4(pos, pos, this.currentProjection);
        
        // Perspective divide
        if (pos[3] <= 0) return null;
        const x = (pos[0] / pos[3] + 1) * this.gl.canvas.width / 2;
        const y = (-pos[1] / pos[3] + 1) * this.gl.canvas.height / 2;
        
        return { x, y };
    }

    transformStarsForProjection(stars, type) {
        if (!stars || stars.length === 0) return [];
        
        return stars.map(star => {
            let coords;
            switch(type) {
                case 'stereographic':
                    coords = this.equatorialToStereographic(star.ra, star.dec);
                    break;
                case 'mercator':
                    coords = this.equatorialToMercator(star.ra, star.dec);
                    break;
                case 'hammer':
                    coords = this.equatorialToHammer(star.ra, star.dec);
                    break;
                default:
                    coords = { x: star.x, y: star.y, z: star.z };
            }
            return { ...star, ...coords };
        });
    }

    equatorialToStereographic(ra, dec) {
        // Stereographic projection
        const raRad = (ra * 15) * Math.PI / 180;  // Convert hours to degrees, then to radians
        const decRad = dec * Math.PI / 180;
        
        // Calculate x and y using stereographic projection formulas
        const cosDec = Math.cos(decRad);
        const k = 2.0 / (1.0 + cosDec * Math.cos(raRad));
        
        return {
            x: k * cosDec * Math.sin(raRad),
            y: k * Math.sin(decRad),
            z: 0
        };
    }

    equatorialToMercator(ra, dec) {
        // Mercator projection
        const raRad = (ra * 15 - 180) * Math.PI / 180;  // Convert to [-180, 180] range
        const decRad = Math.max(Math.min(dec * Math.PI / 180, 1.4835), -1.4835); // Limit to ~85 degrees
        
        return {
            x: raRad,
            y: Math.log(Math.tan(Math.PI/4 + decRad/2)),
            z: 0
        };
    }

    equatorialToHammer(ra, dec) {
        // Hammer-Aitoff projection
        const raRad = (ra * 15 - 180) * Math.PI / 180;  // Convert to [-180, 180] range
        const decRad = dec * Math.PI / 180;
        
        const cosDecSinRaHalf = Math.cos(decRad) * Math.sin(raRad/2);
        const z = Math.sqrt(1 + Math.cos(decRad) * Math.cos(raRad/2));
        
        return {
            x: 2 * Math.sqrt(2) * cosDecSinRaHalf / z,
            y: Math.sqrt(2) * Math.sin(decRad) / z,
            z: 0
        };
    }

    initGrid() {
        // Create grid lines
        this.gridLines = [];
        
        // Declination lines (parallels)
        for (let dec = -80; dec <= 80; dec += 20) {
            const points = [];
            for (let ra = 0; ra <= 24; ra += 0.25) {
                const coords = this.equatorialToCartesian(ra, dec);
                points.push({
                    ...coords,
                    ra: ra,
                    dec: dec
                });
            }
            this.gridLines.push({
                points,
                color: 'rgba(50, 50, 100, 0.3)'
            });
        }
        
        // Right ascension lines (meridians)
        for (let ra = 0; ra < 24; ra += 2) {
            const points = [];
            for (let dec = -90; dec <= 90; dec += 5) {
                const coords = this.equatorialToCartesian(ra, dec);
                points.push({
                    ...coords,
                    ra: ra,
                    dec: dec
                });
            }
            this.gridLines.push({
                points,
                color: 'rgba(50, 50, 100, 0.3)'
            });
        }
    }

    equatorialToCartesian(ra, dec) {
        const raRad = ra * Math.PI / 12;  // Convert hours to radians
        const decRad = dec * Math.PI / 180;  // Convert degrees to radians
        return {
            x: Math.cos(decRad) * Math.cos(raRad),
            y: Math.cos(decRad) * Math.sin(raRad),
            z: Math.sin(decRad)
        };
    }

    spectralTypeToRGB(spectralType) {
        if (!spectralType) return [1, 1, 1];
        
        const type = spectralType.charAt(0).toUpperCase();
        
        // More pronounced color differences
        switch (type) {
            case 'O':  // Hot blue stars (30,000-60,000K)
                return [0.8, 0.8, 1.0];
            case 'B':  // Blue to blue-white (10,000-30,000K)
                return [0.8, 0.9, 1.0];
            case 'A':  // White (7,500-10,000K)
                return [1.0, 1.0, 1.0];
            case 'F':  // Yellow-white (6,000-7,500K)
                return [1.0, 1.0, 0.9];
            case 'G':  // Yellow (5,000-6,000K)
                return [1.0, 1.0, 0.7];
            case 'K':  // Orange (3,500-5,000K)
                return [1.0, 0.9, 0.7];
            case 'M':  // Red (2,000-3,500K)
                return [1.0, 0.7, 0.7];
            default:
                return [1.0, 1.0, 1.0];  // Default to white
        }
    }

    colorIndexToRGB(colorIndex) {
        if (typeof colorIndex !== 'number') return [1, 1, 1];
        
        let r = 1.0;
        let g = 1.0;
        let b = 1.0;
        
        if (colorIndex < 0) {
            // Bluer stars - more pronounced blue
            g = Math.max(0.2, 1.0 + colorIndex * 1.2);  // Reduce green more
            r = Math.max(0.1, g * 0.5);                 // Reduce red even more
        } else {
            // Redder stars - more pronounced red
            b = Math.max(0.0, 1.0 - colorIndex);        // Remove blue completely
            g = Math.max(0.0, 1.0 - colorIndex * 0.8);  // Reduce green significantly
        }
        
        return [
            Math.max(0, Math.min(1, r)),
            Math.max(0, Math.min(1, g)),
            Math.max(0, Math.min(1, b))
        ];
    }
} 
