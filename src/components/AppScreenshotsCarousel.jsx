import React, { useCallback, useEffect, useState } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import Autoplay from 'embla-carousel-autoplay';

export default function AppScreenshotsCarousel({ images = [] }) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true }, [
    Autoplay({ delay: 4000, stopOnInteraction: false })
  ]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollSnaps, setScrollSnaps] = useState([]);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setSelectedIndex(emblaApi.selectedScrollSnap());
  }, [emblaApi, setSelectedIndex]);

  useEffect(() => {
    if (!emblaApi) return;
    // Inicializa el estado derivado y registra el listener del carrusel.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    onSelect();
    setScrollSnaps(emblaApi.scrollSnapList());
    emblaApi.on('select', onSelect);
  }, [emblaApi, setScrollSnaps, onSelect]);

  const scrollTo = useCallback((index) => emblaApi && emblaApi.scrollTo(index), [emblaApi]);

  return (
    <div style={{
      marginTop: '3rem',
      width: '100%',
      maxWidth: '1000px',
      marginLeft: 'auto',
      marginRight: 'auto',
      paddingLeft: '1rem',
      paddingRight: '1rem'
    }}>
      <div
        ref={emblaRef}
        style={{
          overflow: 'hidden',
          borderRadius: '1rem',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          border: '1px solid #f3f4f6',
          backgroundColor: '#ffffff'
        }}
      >
        <div style={{ display: 'flex' }}>
          {images.map((img, index) => (
            <div
              key={index}
              style={{
                flex: '0 0 100%',
                minWidth: 0,
                position: 'relative'
              }}
            >
              <img
                src={img}
                alt={`Screenshot ${index + 1}`}
                style={{
                  width: '100%',
                  height: 'auto',
                  display: 'block',
                  objectFit: 'contain',
                  backgroundColor: '#f8fafc'
                }}
              />
            </div>
          ))}
        </div>
      </div>

      <div style={{
        display: 'flex',
        justifyContent: 'center',
        gap: '0.5rem',
        marginTop: '1.5rem'
      }}>
        {scrollSnaps.map((_, index) => (
          <button
            key={index}
            style={{
              width: index === selectedIndex ? '1.5rem' : '0.625rem',
              height: '0.625rem',
              borderRadius: '9999px',
              transition: 'all 0.3s ease',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              backgroundColor: index === selectedIndex ? '#2563eb' : '#d1d5db'
            }}
            onClick={() => scrollTo(index)}
            aria-label={`Go to slide ${index + 1}`}
          />
        ))}
      </div>
    </div>
  );
}
