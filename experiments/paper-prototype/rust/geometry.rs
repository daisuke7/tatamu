use std::f64::consts::PI;

/// A shape that has a measurable area.
trait Area {
    fn area(&self) -> f64;
    fn describe(&self) -> String {
        format!("area = {:.2}", self.area())
    }
}

#[derive(Debug, Clone, Copy)]
struct Circle {
    radius: f64,
}

#[derive(Debug, Clone, Copy)]
struct Rect {
    width: f64,
    height: f64,
}

impl Area for Circle {
    fn area(&self) -> f64 {
        PI * self.radius * self.radius
    }
}

impl Area for Rect {
    fn area(&self) -> f64 {
        self.width * self.height
    }
}

fn main() {
    let shapes: Vec<Box<dyn Area>> = vec![
        Box::new(Circle { radius: 1.5 }),
        Box::new(Rect { width: 3.0, height: 4.0 }),
    ];
    for shape in &shapes {
        println!("{}", shape.describe());
    }
}
