'use strict';

const APPLICATION_WIDTH = 1024;
const APPLICATION_HEIGHT = 768;
const RED = 0xff0000;
const BLUE = 0x0000ff;
const GREEN = 0x00ff00;
const ORANGE = 0xffa500;
const YELLOW = 0xffff00;
const PURPLE = 0xff00ff;
const WHITE = 0xffffff;
const BOIDS_COUNT = 100;
const BOIDS_SPEED = 3;
const BOID_FRAGMENT_SPEED = 8;
const ALIGNMENT_THRESHOLD = 0.1;
const NEIGHBOUR_MAX_DISTANCE = 60;
const NEIGHBOUR_MIN_DISTANCE = 20;
const AVOID_BORDER_DISTANCE = 50;
const TWEET_PROBABILITY = 0.00025;
const EXPLODE_DISTANCE = 15;
let boids = [];
let boids_exploded_effect = [];

PIXI.sound.add('bird_chirp', 'resources/bird-chirp.wav');
PIXI.sound.add('explosion', 'resources/explosion.wav');

function createGraphicsArrow(color) {
    let graphics = new PIXI.Graphics();
    graphics.beginFill(color);
    graphics.moveTo(5, 0);
    graphics.lineTo(-10, 5);
    graphics.lineTo(-10, -5);
    graphics.endFill();
    return graphics;
}


// Plays a sound and scales the `graphics` object to imitate the 
// a bird.
class TweetEffect {
    tickCount = 0;
    maxTick = 3000;

    constructor(boid) {
        this.boid = boid;
        this.tickCount = 1;
        PIXI.sound.play('bird_chirp');
    }

    remove() {
        this.boid.removeTweetEffect();
    }

    getTickScale(tickCount) {
        return Math.min(0.95 + (5 / tickCount), 3);
    }

    tick() {
        let scale = this.getTickScale(this.tickCount);
        this.boid.setScale(scale);

        if (this.tickCount >= this.maxTick) 
            this.remove();
        this.tickCount++;
    }
};

class BoidFragment {
    maxTick = 20;
    tickCount = 1;
    scale = 0.8;
    dead = false;

    constructor(appStage, position) {
        this.graphics = createGraphicsArrow(WHITE);
        this.graphics.x = position.x;
        this.graphics.y = position.y;
        this.appStage = appStage;
        this.appStage.addChild(this.graphics);
        this.direction = getRandomNormalized2DVector();
        this.speed = BOID_FRAGMENT_SPEED;
    }

    tick() {
        if (this.dead) {
            return;
        }

        this.graphics.scale.set(this.scale, this.scale);
        this.graphics.rotation = getVectorAngle(this.direction);
        this.graphics.x += this.direction.x * this.speed;
        this.graphics.y += this.direction.y * this.speed;
        this.tickCount++;

        if (this.tickCount >= this.maxTick) {
            this.dead = true;
            this.appStage.removeChild(this.graphics);
        }
    }
}

class BoidExplodedEffect {
    fragmentCount = 5;
    fragments = [];
    
    constructor(appStage, position) {
        boids_exploded_effect.push(this);
        for (let i = 0; i < this.fragmentCount; i++) {
            this.fragments.push(new BoidFragment(appStage, position));
        }
    }

    tick() {
        this.fragments.forEach(f => f.tick());
    }
};

class Boid {
    maxTurnSpeed = 0.2;
    turnAcceleration = 0.1;
    turnDelta = 0;
    appStage = null;
    scale = 1;
    tweetEffect = null;
    dead = false;

    constructor(appStage, position) {
        // Draw triangle pointing to angle 0 (to the right).
        this.graphics = createGraphicsArrow(RED);
        appStage.addChild(this.graphics);
        this.appStage = appStage;

        // Set position.
        this.graphics.x = position.x;
        this.graphics.y = position.y;


        // Direction and speed are randomly initialized.
        this.direction = getRandomNormalized2DVector();

        this.speed = BOIDS_SPEED;

        // Add to global boids vector.
        boids.push(this);
    }

    switchColor(color) {
        let position = this.getPosition();
        let rotation = this.graphics.rotation;
        this.appStage.removeChild(this.graphics);
        this.graphics = createGraphicsArrow(color);
        this.graphics.x = position.x;
        this.graphics.y = position.y;
        this.graphics.rotation = rotation;
        this.graphics.scale.set(this.scale, this.scale);
        this.appStage.addChild(this.graphics);
    }

    avoidBorders() {
        if (this.graphics.y < AVOID_BORDER_DISTANCE) {
            // Avoid top collision.
            return getRotationDelta(this.direction, { x: 0, y: 1 });
        } else if (this.graphics.y > (APPLICATION_HEIGHT - AVOID_BORDER_DISTANCE)) {
            // Avoid bottom collision.
            return getRotationDelta(this.direction, { x: 0, y: -1 });
        } else if (this.graphics.x < AVOID_BORDER_DISTANCE) {
            // Avoid left collision.
            return getRotationDelta(this.direction, { x: 1, y: 0 });
        } else if (this.graphics.x > (APPLICATION_WIDTH - AVOID_BORDER_DISTANCE)) {
            // Avoid right collision.
            return getRotationDelta(this.direction, { x: -1, y: 0 });
        }
        return 0;
    }

    getPosition() {
        return {
            x: this.graphics.x,
            y: this.graphics.y
        };
    }

    setScale(scale) {
        this.scale = scale;
    }

    getNeighbours(distance) {
        let neighbours = [];
        for (let i = 0; i < boids.length; i++) {
            let b = boids[i];
            if (b == this) continue;

            if (distanceBetweenPoints(b.getPosition(),
                this.getPosition()) < distance) {
                neighbours.push(b);
                this.switchColor(ORANGE);
            }
        }
        return neighbours;
    }

    alignWithNeighboursTurnAngle(neighbours) {
        if (neighbours.length == 0)
            return 0;

        let avg_direction = { x: 0, y: 0 };
        for (let i = 0; i < neighbours.length; i++) {
            let n = neighbours[i];
            avg_direction.x += n.getDirection().x;
            avg_direction.y += n.getDirection().y;
        }

        avg_direction.x /= neighbours.length;
        avg_direction.y /= neighbours.length;

        return getRotationDelta(this.direction, avg_direction);
    }

    separateFromNeighboursTooClose(neighbours) {
        let get_away_vector = { x: 0, y: 0 };
        let count = 0;
        for (let i = 0; i < neighbours.length; i++) {
            let n = neighbours[i];
            if (n == this) continue;

            if (distanceBetweenPoints(n.getPosition(),
                this.getPosition()) < NEIGHBOUR_MIN_DISTANCE) {
                get_away_vector.x += this.getPosition().x - n.getPosition().x;
                get_away_vector.y += this.getPosition().y - n.getPosition().y;
                count++;
            }
        }

        if (count == 0)
            return 0;
        get_away_vector.x /= count;
        get_away_vector.y /= count;
        if (get_away_vector.x == 0 && get_away_vector.y == 0)
            return 0;

        get_away_vector = normalizeVector(get_away_vector);
        return getRotationDelta(this.direction, get_away_vector);
    }

    getDirection() {
        return this.direction;
    }

    removeTweetEffect() {
        this.tweetEffect = null;
    }

    explode() {
        this.dead = true;
        this.appStage.removeChild(this.graphics);
        PIXI.sound.play('explosion');
        new BoidExplodedEffect(this.appStage, this.getPosition());
    }

    explodeIfTooCloseToNeighbour(neighbours) {
        for (let i = 0; i < neighbours.length; i++) {
            let n = neighbours[i];
            if (n == this) continue;

            if (!n.isDead() && 
                distanceBetweenPoints(n.getPosition(),
                this.getPosition()) < EXPLODE_DISTANCE) {
                this.explode();
            }
        }
    }

    isDead() {
        return this.dead;
    }

    moveInBetweenNeighbours(neighbours) {
        if (neighbours.length < 2)
            return 0;

        let in_between_position = { x: 0, y: 0 };
        for (let i = 0; i < neighbours.length; i++) {
            let n = neighbours[i];

            in_between_position.x += n.getPosition().x;
            in_between_position.y += n.getPosition().y;
        }
        in_between_position.x /= neighbours.length;
        in_between_position.y /= neighbours.length;

        let in_between_direction = {
            x: in_between_position.x - this.getPosition().x,
            y: in_between_position.y - this.getPosition().y
        };
        in_between_direction = normalizeVector(in_between_direction);

        return getRotationDelta(this.direction, in_between_direction);
    }

    randomTweetSoundAndScaling() {
        if (this.tweetEffect == null) {
            if (Math.random() < TWEET_PROBABILITY) {
                this.tweetEffect = new TweetEffect(this);
            }
        } else {
            this.tweetEffect.tick();
        }
    }

    tick() {
        if (this.dead) {
            return;
        }

        this.switchColor(RED);
        // Move towards `direction` at `speed` velocity.
        this.graphics.x += this.direction.x * this.speed;
        this.graphics.y += this.direction.y * this.speed;

        this.graphics.scale.set(this.scale, this.scale);
        this.graphics.rotation = getVectorAngle(this.direction);

        // Compute turn.
        let avoidBordersTurnAngle = this.avoidBorders();
        let neighbours = this.getNeighbours(NEIGHBOUR_MAX_DISTANCE);
        let separationAngle = this.separateFromNeighboursTooClose(neighbours);
        let cohesionAngle = this.moveInBetweenNeighbours(neighbours);
        let alignmentAngle = this.alignWithNeighboursTurnAngle(neighbours);
        let requestedTurnAngle = 0;
        if (avoidBordersTurnAngle != 0) {
            requestedTurnAngle = avoidBordersTurnAngle;
            this.switchColor(GREEN);
        } else if (separationAngle != 0) {
            requestedTurnAngle = separationAngle;
            this.switchColor(BLUE);
        } else if (Math.abs(alignmentAngle) > ALIGNMENT_THRESHOLD) {
            requestedTurnAngle = alignmentAngle;
            this.switchColor(YELLOW);
        } else if (cohesionAngle != 0) {
            requestedTurnAngle = cohesionAngle;
            this.switchColor(PURPLE);
        }
        let turn = getPossibleTurnRadians(this.turnDelta, this.turnAcceleration, this.maxTurnSpeed, requestedTurnAngle);
        this.direction = turnVector(this.direction, turn);

        this.explodeIfTooCloseToNeighbour(neighbours);

        this.randomTweetSoundAndScaling();
    }
};

function getRandomNormalized2DVector() {
    let vector = { x: Math.random(), y: Math.random() };
    let vectorLength = Math.sqrt(vector.x * vector.x) + Math.sqrt(vector.y * vector.y);
    vector.x /= vectorLength;
    vector.y /= vectorLength;
    
    if (Math.random() > 0.5) vector.x *= -1;
    if (Math.random() > 0.5) vector.y *= -1;
    return vector;
}

function getRandomPointInScreen() {
    return { x: Math.random() * APPLICATION_WIDTH, y: Math.random() * APPLICATION_HEIGHT };
}

// Gets the vector angle in radians.
function getVectorAngle(vector) {
    return Math.atan2(vector.y, vector.x);
}

// Create the application helper and add its render target to the page
let app = new PIXI.Application({ width: APPLICATION_WIDTH, height: APPLICATION_HEIGHT });
document.body.appendChild(app.view);

// Add it to the stage to render
for (let i = 0; i < BOIDS_COUNT; i++) {
    let position = getRandomPointInScreen();
    new Boid(app.stage, position);
}

// Add a ticker callback to move the sprite back and forth
let elapsed = 0.0;
app.ticker.add((delta) => {
    elapsed += delta;
    boids.forEach(boid => boid.tick());
    boids_exploded_effect.forEach(effect => effect.tick());
});